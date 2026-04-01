import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tempDirs: string[] = []

const { getDatabaseMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function createSkillsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      content_hash TEXT,
      registry_slug TEXT,
      registry_version TEXT,
      security_status TEXT,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, name)
    );
  `)
}

function createSkillDoc(workspacePath: string, name: string, content: string) {
  const skillDir = join(workspacePath, 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf8')
}

describe('agent skills importer', () => {
  let db: Database.Database
  let workspacePath: string

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'mc-org-agent-skills-'))
    tempDirs.push(workspacePath)
    db = new Database(':memory:')
    createSkillsTable(db)
    getDatabaseMock.mockReturnValue(db)
  })

  afterEach(() => {
    db.close()
    getDatabaseMock.mockReset()
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds org-agent source keys from normalized agent names', async () => {
    const { buildOrgAgentSkillSource } = await import('@/lib/agent-skills-importer')
    expect(buildOrgAgentSkillSource('Atlas Coordinator')).toBe('org-agent:atlas-coordinator')
  })

  it('inserts imported rows keyed by org-agent source and updates them on re-import', async () => {
    createSkillDoc(
      workspacePath,
      'Retrospective',
      '# Retrospective\n\nInitial reflection workflow.\n\nMore details.\n',
    )

    const { syncOrgAgentSkills } = await import('@/lib/agent-skills-importer')

    const first = await syncOrgAgentSkills({
      agentId: 1,
      agentName: 'Atlas Coordinator',
      workspacePath,
    })

    expect(first.source).toBe('org-agent:atlas-coordinator')
    expect(first.created).toBe(1)

    const inserted = db.prepare(
      'SELECT source, name, description, content_hash, updated_at FROM skills WHERE source = ? AND name = ?',
    ).get('org-agent:atlas-coordinator', 'Retrospective') as {
      source: string
      name: string
      description: string | null
      content_hash: string | null
      updated_at: string
    }

    expect(inserted.source).toBe('org-agent:atlas-coordinator')
    expect(inserted.name).toBe('Retrospective')
    expect(inserted.description).toBe('Initial reflection workflow.')

    const initialHash = inserted.content_hash
    const initialUpdatedAt = inserted.updated_at

    writeFileSync(
      join(workspacePath, 'skills', 'Retrospective', 'SKILL.md'),
      '# Retrospective\n\nUpdated reflection workflow.\n\nChanged details.\n',
      'utf8',
    )

    const second = await syncOrgAgentSkills({
      agentId: 1,
      agentName: 'Atlas Coordinator',
      workspacePath,
    })

    expect(second.updated).toBe(1)

    const updated = db.prepare(
      'SELECT description, content_hash, updated_at FROM skills WHERE source = ? AND name = ?',
    ).get('org-agent:atlas-coordinator', 'Retrospective') as {
      description: string | null
      content_hash: string | null
      updated_at: string
    }

    expect(updated.description).toBe('Updated reflection workflow.')
    expect(updated.content_hash).not.toBe(initialHash)
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(initialUpdatedAt))
  })

  it('deletes only missing rows for the same org-agent source', async () => {
    createSkillDoc(
      workspacePath,
      'Retrospective',
      '# Retrospective\n\nInitial reflection workflow.\n',
    )
    createSkillDoc(
      workspacePath,
      'Planning',
      '# Planning\n\nPlan deliberately.\n',
    )

    const { syncOrgAgentSkills } = await import('@/lib/agent-skills-importer')

    await syncOrgAgentSkills({
      agentId: 1,
      agentName: 'Atlas Coordinator',
      workspacePath,
    })

    db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Retrospective',
      'org-agent:beacon-lead',
      '/tmp/beacon/Retrospective',
      'Beacon version',
      'beacon-hash',
      new Date().toISOString(),
      new Date().toISOString(),
    )

    rmSync(join(workspacePath, 'skills', 'Retrospective'), { recursive: true, force: true })

    const result = await syncOrgAgentSkills({
      agentId: 1,
      agentName: 'Atlas Coordinator',
      workspacePath,
    })

    expect(result.deleted).toBe(1)

    const atlasRow = db.prepare(
      'SELECT name FROM skills WHERE source = ? AND name = ?',
    ).get('org-agent:atlas-coordinator', 'Retrospective')
    const beaconRow = db.prepare(
      'SELECT name FROM skills WHERE source = ? AND name = ?',
    ).get('org-agent:beacon-lead', 'Retrospective')

    expect(atlasRow).toBeUndefined()
    expect(beaconRow).toMatchObject({ name: 'Retrospective' })
  })

  it('removes only that agent source when the skills directory is empty or missing', async () => {
    createSkillDoc(
      workspacePath,
      'Planning',
      '# Planning\n\nPlan deliberately.\n',
    )

    const { syncOrgAgentSkills } = await import('@/lib/agent-skills-importer')

    await syncOrgAgentSkills({
      agentId: 1,
      agentName: 'Atlas Coordinator',
      workspacePath,
    })

    db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Analysis',
      'org-agent:beacon-lead',
      '/tmp/beacon/Analysis',
      'Beacon version',
      'beacon-hash',
      new Date().toISOString(),
      new Date().toISOString(),
    )

    rmSync(join(workspacePath, 'skills'), { recursive: true, force: true })

    const result = await syncOrgAgentSkills({
      agentId: 1,
      agentName: 'Atlas Coordinator',
      workspacePath,
    })

    expect(result.deleted).toBe(1)
    expect(result.total).toBe(0)

    const atlasRows = db.prepare(
      'SELECT name FROM skills WHERE source = ?',
    ).all('org-agent:atlas-coordinator')
    const beaconRows = db.prepare(
      'SELECT name FROM skills WHERE source = ?',
    ).all('org-agent:beacon-lead')

    expect(atlasRows).toEqual([])
    expect(beaconRows).toHaveLength(1)
  })
})
