import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const invalidateOrgSnapshot = vi.fn()
const prepare = vi.fn()
const transaction = vi.fn((fn: () => void) => () => fn())

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare, transaction })),
}))

vi.mock('@/lib/org-scanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org-scanner')>()
  return {
    ...actual,
    invalidateOrgSnapshot,
  }
})

describe('PATCH /api/teams/:id/assignments', () => {
  let tempDir: string

  beforeEach(() => {
    vi.resetModules()
    tempDir = mkdtempSync(path.join(tmpdir(), 'team-assignments-'))
    requireRole.mockReturnValue({ user: { id: 1, username: 'operator', role: 'operator', workspace_id: 1 } })
    invalidateOrgSnapshot.mockReset()
    prepare.mockReset()
    transaction.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('promotes agent to lead, demotes the previous lead, and persists both roles to filesystem metadata', async () => {
    const teamDir = path.join(tempDir, 'platform')
    const promotedDir = path.join(teamDir, 'ada')
    const priorLeadDir = path.join(teamDir, 'grace')

    mkdirSync(teamDir, { recursive: true })
    mkdirSync(promotedDir, { recursive: true })
    mkdirSync(priorLeadDir, { recursive: true })

    const upsertAssignment = { run: vi.fn() }
    const demoteLead = { run: vi.fn() }

    prepare.mockImplementation((sql: string) => {
      if (sql.includes('FROM teams')) {
        return { get: vi.fn(() => ({ source_path: teamDir })) }
      }
      if (sql.includes('FROM agent_team_assignments')) {
        return { get: vi.fn(() => ({ role: 'member', workspace_path: promotedDir })) }
      }
      if (sql.includes('INSERT INTO agent_team_assignments')) return upsertAssignment
      if (sql.includes("SET role = 'member', source = 'manual'")) return demoteLead
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { PATCH } = await import('@/app/api/teams/[id]/assignments/route')
    const request = new NextRequest('http://localhost/api/teams/42/assignments', {
      method: 'PATCH',
      body: JSON.stringify({ agent_id: 7, role: 'lead' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: '42' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(upsertAssignment.run).toHaveBeenCalledWith(1, 7, 42, 'lead')
    expect(demoteLead.run).toHaveBeenCalledWith(1, 42, 7)
    expect(invalidateOrgSnapshot).toHaveBeenCalledWith(1)
    expect(JSON.parse(readFileSync(path.join(teamDir, '.team.json'), 'utf8'))).toEqual({
      lead_agent_dir: 'ada',
    })
  })

  it('returns a 500 response when filesystem-backed persistence fails instead of throwing', async () => {
    const invalidTeamPath = path.join(tempDir, 'not-a-directory')
    writeFileSync(invalidTeamPath, 'x', 'utf8')

    prepare.mockImplementation((sql: string) => {
      if (sql.includes('FROM teams')) {
        return { get: vi.fn(() => ({ source_path: invalidTeamPath })) }
      }
      if (sql.includes('FROM agent_team_assignments')) {
        return { get: vi.fn(() => ({ role: 'member', workspace_path: path.join(invalidTeamPath, 'ada') })) }
      }
      if (sql.includes('INSERT INTO agent_team_assignments')) return { run: vi.fn() }
      if (sql.includes("SET role = 'member', source = 'manual'")) return { run: vi.fn() }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { PATCH } = await import('@/app/api/teams/[id]/assignments/route')
    const request = new NextRequest('http://localhost/api/teams/42/assignments', {
      method: 'PATCH',
      body: JSON.stringify({ agent_id: 7, role: 'lead' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: '42' }) })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Failed to update team assignment')
    expect(invalidateOrgSnapshot).not.toHaveBeenCalled()
  })
})
