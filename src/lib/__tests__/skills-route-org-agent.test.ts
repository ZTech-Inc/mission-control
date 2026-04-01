import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tempDirs: string[] = []

const {
  requireRoleMock,
  getDatabaseMock,
  checkSkillSecurityMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(() => ({ user: { role: 'viewer' } })),
  getDatabaseMock: vi.fn(),
  checkSkillSecurityMock: vi.fn(() => ({ status: 'clean', issues: [] })),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('@/lib/skill-registry', () => ({
  checkSkillSecurity: checkSkillSecurityMock,
}))

type SkillRow = {
  name: string
  source: string
  path: string
  description: string | null
  registry_slug?: string | null
  security_status?: string | null
}

class FakeSkillsDb {
  constructor(private rows: SkillRow[]) {}

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()

    return {
      all: () => {
        if (normalized.startsWith('select name, source, path, description, registry_slug, security_status from skills')) {
          return [...this.rows].sort((a, b) => a.name.localeCompare(b.name))
        }
        return []
      },
      get: (...args: unknown[]) => {
        if (normalized === 'select source, name, path from skills where source = ? and name = ?') {
          const [source, name] = args as [string, string]
          const row = this.rows.find((entry) => entry.source === source && entry.name === name)
          return row ? { source: row.source, name: row.name, path: row.path } : undefined
        }
        return undefined
      },
    }
  }
}

describe('/api/skills org-agent behavior', () => {
  let orgSkillPath: string

  beforeEach(() => {
    const baseDir = mkdtempSync(join(tmpdir(), 'mc-skills-route-'))
    tempDirs.push(baseDir)
    orgSkillPath = join(baseDir, 'Retrospective')
    mkdirSync(orgSkillPath, { recursive: true })
    writeFileSync(join(orgSkillPath, 'SKILL.md'), '# Retrospective\n\nAtlas-specific workflow.\n', 'utf8')
    requireRoleMock.mockReturnValue({ user: { role: 'viewer' } })
    checkSkillSecurityMock.mockReturnValue({ status: 'clean', issues: [] })
  })

  afterEach(() => {
    getDatabaseMock.mockReset()
    requireRoleMock.mockReset()
    checkSkillSecurityMock.mockReset()
    vi.resetModules()
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns content for org-agent rows from the stored DB path', async () => {
    getDatabaseMock.mockReturnValue(new FakeSkillsDb([
      {
        name: 'Retrospective',
        source: 'org-agent:atlas-coordinator',
        path: orgSkillPath,
        description: 'Atlas-specific workflow.',
      },
    ]))

    const { GET } = await import('@/app/api/skills/route')
    const request = new NextRequest(
      'http://localhost/api/skills?mode=content&source=org-agent:atlas-coordinator&name=Retrospective',
    )

    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.source).toBe('org-agent:atlas-coordinator')
    expect(body.skillPath).toBe(orgSkillPath)
    expect(body.content).toContain('Atlas-specific workflow.')
  })

  it('returns 404 when the DB row exists but SKILL.md is missing', async () => {
    rmSync(join(orgSkillPath, 'SKILL.md'), { force: true })
    getDatabaseMock.mockReturnValue(new FakeSkillsDb([
      {
        name: 'Retrospective',
        source: 'org-agent:atlas-coordinator',
        path: orgSkillPath,
        description: 'Atlas-specific workflow.',
      },
    ]))

    const { GET } = await import('@/app/api/skills/route')
    const request = new NextRequest(
      'http://localhost/api/skills?mode=content&source=org-agent:atlas-coordinator&name=Retrospective',
    )

    const response = await GET(request)
    expect(response.status).toBe(404)
  })

  it('includes org-agent groups in the grouped response and keeps flat rows source-aware', async () => {
    const sharedPath = join(tempDirs[0]!, 'shared')
    mkdirSync(sharedPath, { recursive: true })

    getDatabaseMock.mockReturnValue(new FakeSkillsDb([
      {
        name: 'Retrospective',
        source: 'org-agent:atlas-coordinator',
        path: orgSkillPath,
        description: 'Atlas-specific workflow.',
      },
      {
        name: 'Retrospective',
        source: 'user-agents',
        path: sharedPath,
        description: 'Global workflow.',
      },
    ]))

    const { GET } = await import('@/app/api/skills/route')
    const request = new NextRequest('http://localhost/api/skills')

    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'org-agent:atlas-coordinator' }),
      ]),
    )
    expect(body.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'org-agent:atlas-coordinator', name: 'Retrospective' }),
        expect.objectContaining({ source: 'user-agents', name: 'Retrospective' }),
      ]),
    )
  })
})
