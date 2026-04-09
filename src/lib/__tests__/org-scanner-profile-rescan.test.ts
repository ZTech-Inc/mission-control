import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const agentMd = `# AGENT.md — Agent Builder

## Agent Configuration

| Property | Value |
|----------|-------|
| **Agent Name** | Agent Builder |
| **Role / Title** | Team Lead – Agent Dev |
| **Department** | AI Automation |
| **Team** | AGENT DEVELOPMENT |
|
## Core Skills

- Multi-agent systems
- agent frameworks
- tool use

## Key Deliverables

- Custom agent architectures
- agent deployments

## KPI

Agent deployment success rate

## Protocol Stack

| Protocol | Purpose |
|----------|---------|
| **A2A** | Agent-to-Agent communication for cross-team collaboration |
| **ACP** | Agent Communication Protocol for structured messaging |
| **MCP** | Model Context Protocol for tool and context integration |
| **ICP** | Internal Communication Protocol for policy enforcement |

## Operating Parameters

- **Runtime:** codex

## Dependencies

- Reports to: AGENT DEVELOPMENT Team Lead
- Collaborates with: All agents within AI Automation department
`

const identityMd = `# IDENTITY.md — Agent Builder

## Expertise Domain

- Multi-agent systems
- prompt engineering
`

const originalEnv = {
  AGENTS_DIR: process.env.AGENTS_DIR,
  MISSION_CONTROL_AGENTS_DIR: process.env.MISSION_CONTROL_AGENTS_DIR,
  MISSION_CONTROL_DATA_DIR: process.env.MISSION_CONTROL_DATA_DIR,
  MISSION_CONTROL_DB_PATH: process.env.MISSION_CONTROL_DB_PATH,
  MISSION_CONTROL_TEST_MODE: process.env.MISSION_CONTROL_TEST_MODE,
}

let tempRoot: string | null = null
const originalFetch = global.fetch
const originalEventSource = global.EventSource

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function writeAgentFixture(rootDir: string) {
  const agentDir = path.join(rootDir, 'AI_Automation', 'AGENT_DEVELOPMENT', 'Agent_Builder')
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), agentMd)
  fs.writeFileSync(path.join(agentDir, 'IDENTITY.md'), identityMd)
  return agentDir
}

async function loadScannerModules() {
  vi.resetModules()
  const scanner = await import('@/lib/org-scanner')
  const db = await import('@/lib/db')
  return { ...scanner, ...db }
}

afterEach(async () => {
  try {
    const { closeDatabase, invalidateOrgSnapshot } = await loadScannerModules()
    invalidateOrgSnapshot()
    closeDatabase()
  } catch {
    // Ignore cleanup failures from partially loaded modules.
  }

  restoreEnv()

  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }

  global.fetch = originalFetch
  global.EventSource = originalEventSource
  vi.doUnmock('@/store')
  vi.clearAllMocks()
})

describe('getOrgSnapshot force rescans', () => {
  it('reproduces the Phase 04 gap when force rescans fail to keep enriched profile columns populated', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-org-scan-'))
    const agentsRoot = path.join(tempRoot, 'agents')
    const dataRoot = path.join(tempRoot, 'data')
    const dbPath = path.join(dataRoot, 'mission-control.db')
    writeAgentFixture(agentsRoot)

    process.env.AGENTS_DIR = agentsRoot
    process.env.MISSION_CONTROL_DATA_DIR = dataRoot
    process.env.MISSION_CONTROL_DB_PATH = dbPath
    process.env.MISSION_CONTROL_TEST_MODE = '1'

    const { getOrgSnapshot, invalidateOrgSnapshot, getDatabase, closeDatabase } = await loadScannerModules()

    getOrgSnapshot({ force: true, workspaceId: 1 })

    const db = getDatabase()
    const row = db.prepare(`
      SELECT name, skills, protocol_stack, kpis, deliverables, dependencies, preferred_runtime, openclaw_id
      FROM agents
      WHERE workspace_id = 1 AND name = ?
    `).get('Agent Builder') as Record<string, unknown> | undefined

    expect(row).toBeDefined()
    expect(row?.skills).toBe(JSON.stringify(['Multi-agent systems', 'agent frameworks', 'tool use', 'prompt engineering']))
    expect(row?.protocol_stack).toBe(JSON.stringify(['A2A', 'ACP', 'MCP', 'ICP']))
    expect(row?.kpis).toBe(JSON.stringify(['Agent deployment success rate']))
    expect(row?.deliverables).toBe(JSON.stringify(['Custom agent architectures', 'agent deployments']))
    expect(row?.dependencies).toBe(
      JSON.stringify([
        'Reports to: AGENT DEVELOPMENT Team Lead',
        'Collaborates with: All agents within AI Automation department',
      ])
    )
    expect(row?.preferred_runtime).toBe('codex')
    expect(row?.openclaw_id).toBe('agent-builder')

    invalidateOrgSnapshot(1)
    closeDatabase()

    const reloaded = await loadScannerModules()
    reloaded.getOrgSnapshot({ force: true, workspaceId: 1 })
    const rescannedRow = reloaded.getDatabase().prepare(`
      SELECT skills, protocol_stack, kpis, deliverables, dependencies, preferred_runtime, openclaw_id
      FROM agents
      WHERE workspace_id = 1 AND name = ?
    `).get('Agent Builder') as Record<string, unknown> | undefined

    expect(rescannedRow).toEqual({
      skills: JSON.stringify(['Multi-agent systems', 'agent frameworks', 'tool use', 'prompt engineering']),
      protocol_stack: JSON.stringify(['A2A', 'ACP', 'MCP', 'ICP']),
      kpis: JSON.stringify(['Agent deployment success rate']),
      deliverables: JSON.stringify(['Custom agent architectures', 'agent deployments']),
      dependencies: JSON.stringify([
        'Reports to: AGENT DEVELOPMENT Team Lead',
        'Collaborates with: All agents within AI Automation department',
      ]),
      preferred_runtime: 'codex',
      openclaw_id: 'agent-builder',
    })
  })

  it('reproduces the post-rescan UI gap by requiring the org hook to refresh agents alongside the snapshot', async () => {
    const snapshot = {
      departments: [],
      teams: [],
      agentAssignments: [],
      source: 'filesystem' as const,
      rootPath: '/tmp/agents',
      scannedAt: 1,
    }
    const agentsPayload = {
      agents: [
        {
          id: 1,
          name: 'Agent Builder',
          role: 'Team Lead – Agent Dev',
          skills: ['Multi-agent systems'],
          protocol_stack: ['MCP'],
          kpis: ['Agent deployment success rate'],
          deliverables: ['Custom agent architectures'],
          dependencies: ['Reports to: AGENT DEVELOPMENT Team Lead'],
          preferred_runtime: 'codex',
          openclaw_id: 'agent-builder',
        },
      ],
    }

    const setDepartments = vi.fn()
    const setTeams = vi.fn()
    const setAgentTeamAssignments = vi.fn()
    const setAgents = vi.fn()

    vi.resetModules()
    vi.doMock('@/store', () => ({
      useMissionControl: (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          setDepartments,
          setTeams,
          setAgentTeamAssignments,
          setAgents,
        }),
    }))

    class FakeEventSource {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      onerror: (() => void) | null = null
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }

    global.EventSource = FakeEventSource as unknown as typeof EventSource
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/org/scan') {
        return {
          ok: true,
          json: async () => snapshot,
        } as Response
      }

      if (url.startsWith('/api/agents')) {
        return {
          ok: true,
          json: async () => agentsPayload,
        } as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const { renderHook, waitFor } = await import('@testing-library/react')
    const { useOrgData } = await import('@/lib/use-org-data')

    renderHook(() => useOrgData())

    await waitFor(() => {
      expect(setDepartments).toHaveBeenCalledWith(snapshot.departments)
      expect(setTeams).toHaveBeenCalledWith(snapshot.teams)
      expect(setAgentTeamAssignments).toHaveBeenCalledWith(snapshot.agentAssignments)
    })

    await waitFor(() => {
      expect(setAgents).toHaveBeenCalledWith(agentsPayload.agents)
    })
  })
})
