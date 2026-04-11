import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveSessionPoolHealth, suggestModelForAgentAccount } from '@/lib/session-pool'

const originalEnv = {
  MISSION_CONTROL_DATA_DIR: process.env.MISSION_CONTROL_DATA_DIR,
  MISSION_CONTROL_DB_PATH: process.env.MISSION_CONTROL_DB_PATH,
  MISSION_CONTROL_TEST_MODE: process.env.MISSION_CONTROL_TEST_MODE,
}

let tempRoot: string | null = null

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

async function loadSessionPoolModules() {
  vi.resetModules()
  const sessionPool = await import('@/lib/session-pool')
  const db = await import('@/lib/db')
  return { ...sessionPool, ...db }
}

function createTempDbEnv() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-session-pool-'))
  const dataRoot = path.join(tempRoot, 'data')
  process.env.MISSION_CONTROL_DATA_DIR = dataRoot
  process.env.MISSION_CONTROL_DB_PATH = path.join(dataRoot, 'mission-control.db')
  process.env.MISSION_CONTROL_TEST_MODE = '1'
}

function insertAgent(
  db: any,
  input: {
    name: string
    role: string
    status?: string
    runtimeType?: string | null
    preferredRuntime?: string | null
    config?: Record<string, unknown> | null
  },
) {
  db.prepare(`
    INSERT INTO agents (
      workspace_id, name, role, status, hidden, config, runtime_type, preferred_runtime, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    1,
    input.name,
    input.role,
    input.status || 'idle',
    input.config ? JSON.stringify(input.config) : null,
    input.runtimeType ?? null,
    input.preferredRuntime ?? null,
  )
}

afterEach(async () => {
  try {
    const { closeDatabase } = await import('@/lib/db')
    closeDatabase()
  } catch {
    // Ignore cleanup failures from partially loaded test modules.
  }

  restoreEnv()
  if (tempRoot) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      // Windows may keep WAL files locked briefly after test teardown.
    }
    tempRoot = null
  }
  vi.clearAllMocks()
})

describe('suggestModelForAgentAccount', () => {
  const agent = {
    config: JSON.stringify({
      model: {
        primary: 'anthropic/claude-sonnet-4-6',
        fallbacks: ['openai/codex-mini-latest', 'ollama/qwen2.5-coder:14b'],
      },
    }),
    runtime_type: 'openclaw',
    preferred_runtime: 'codex',
  }

  it('prefers an agent fallback model that matches the account provider', () => {
    expect(
      suggestModelForAgentAccount(agent, {
        provider: 'openai',
        preferred_model: null,
      }),
    ).toBe('openai/codex-mini-latest')
  })

  it('falls back to a provider default when the agent has no matching model', () => {
    expect(
      suggestModelForAgentAccount(agent, {
        provider: 'groq',
        preferred_model: null,
      }),
    ).toBe('groq/llama-3.3-70b-versatile')
  })
})

describe('deriveSessionPoolHealth', () => {
  const zeroUsage = {
    cost30d: 0,
    requestCount30d: 0,
    totalTokens30d: 0,
    totalTokens1d: 0,
    requestCount1d: 0,
    monthlyBudgetPct: null,
    dailyTokenPct: null,
    dailyRequestPct: null,
    maxLimitPct: null,
  }

  it('marks enabled accounts as healthy when no limits or failures are present', () => {
    expect(deriveSessionPoolHealth({
      enabled: 1,
      status: 'active',
      consecutive_failures: 0,
      last_success_at: null,
      last_failure_at: null,
      cooldown_until: null,
      soft_limit_pct: 80,
      hard_limit_pct: 95,
    }, zeroUsage).state).toBe('healthy')
  })

  it('marks accounts as exhausted when a hard limit is exceeded', () => {
    expect(deriveSessionPoolHealth({
      enabled: 1,
      status: 'active',
      consecutive_failures: 0,
      last_success_at: null,
      last_failure_at: null,
      cooldown_until: null,
      soft_limit_pct: 80,
      hard_limit_pct: 95,
    }, {
      ...zeroUsage,
      monthlyBudgetPct: 97,
      maxLimitPct: 97,
    }).state).toBe('exhausted')
  })

  it('marks accounts in cooldown ahead of repeated failure fallback', () => {
    const future = Math.floor(Date.now() / 1000) + 60
    expect(deriveSessionPoolHealth({
      enabled: 1,
      status: 'degraded',
      consecutive_failures: 2,
      last_success_at: null,
      last_failure_at: null,
      cooldown_until: future,
      soft_limit_pct: 80,
      hard_limit_pct: 95,
    }, zeroUsage).state).toBe('cooldown')
  })
})

describe('rebalanceSessionPool', () => {
  it('routes low-need agents to efficient sessions, keeps explicit codex agents on openai, and dedupes same-resource fallbacks', async () => {
    createTempDbEnv()
    const {
      createSessionAccount,
      getDatabase,
      getSessionPoolSnapshot,
      listDispatchCandidatesForAgent,
      rebalanceSessionPool,
    } = await loadSessionPoolModules()

    const db = getDatabase()
    insertAgent(db, {
      name: 'codex-main',
      role: 'developer',
      runtimeType: 'codex',
      preferredRuntime: 'codex',
      config: {
        model: {
          primary: 'openai/gpt-5.4',
        },
      },
    })
    insertAgent(db, {
      name: 'C3-PO',
      role: 'protocol droid',
    })

    createSessionAccount(1, {
      label: 'Codex A',
      provider: 'openai',
      runtimeType: 'codex',
      preferredModel: 'openai/gpt-5.4',
      credentialRef: 'codex-auth:alpha',
    })
    createSessionAccount(1, {
      label: 'Codex A Mirror',
      provider: 'openai',
      runtimeType: 'codex',
      preferredModel: 'openai/gpt-5.4',
      credentialRef: 'codex-auth:alpha',
    })
    createSessionAccount(1, {
      label: 'OpenRouter Free',
      provider: 'openrouter',
      runtimeType: 'openrouter',
      preferredModel: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
      credentialRef: 'env:OPENROUTER_API_KEY',
    })

    rebalanceSessionPool(1)
    const snapshot = getSessionPoolSnapshot(1)

    const codexAgent = snapshot.agents.find((agent) => agent.name === 'codex-main')
    const c3po = snapshot.agents.find((agent) => agent.name === 'C3-PO')

    expect(codexAgent?.allocationChain.map((entry) => entry.provider)).toEqual(['openai', 'openrouter'])
    expect(c3po?.allocationChain.map((entry) => entry.provider)).toEqual(['openrouter', 'openai'])

    const c3poCandidates = listDispatchCandidatesForAgent(1, c3po!.id)
    expect(c3poCandidates.map((entry) => `${entry.provider}:${entry.credentialRef}`)).toEqual([
      'openrouter:env:OPENROUTER_API_KEY',
      'openai:codex-auth:alpha',
    ])
  })

  it('spreads equivalent codex workloads across distinct credentials instead of pinning everything to the first account', async () => {
    createTempDbEnv()
    const {
      createSessionAccount,
      getDatabase,
      getSessionPoolSnapshot,
      rebalanceSessionPool,
    } = await loadSessionPoolModules()

    const db = getDatabase()
    insertAgent(db, {
      name: 'codex-main',
      role: 'developer',
      runtimeType: 'codex',
      preferredRuntime: 'codex',
      config: {
        model: {
          primary: 'openai/gpt-5.4',
        },
      },
    })
    insertAgent(db, {
      name: 'codex-review',
      role: 'security reviewer',
      runtimeType: 'codex',
      preferredRuntime: 'codex',
      config: {
        model: {
          primary: 'openai/gpt-5.4',
        },
      },
    })

    createSessionAccount(1, {
      label: 'Codex Alpha',
      provider: 'openai',
      runtimeType: 'codex',
      preferredModel: 'openai/gpt-5.4',
      credentialRef: 'codex-auth:alpha',
    })
    createSessionAccount(1, {
      label: 'Codex Beta',
      provider: 'openai',
      runtimeType: 'codex',
      preferredModel: 'openai/gpt-5.4',
      credentialRef: 'codex-auth:beta',
    })

    rebalanceSessionPool(1)
    const snapshot = getSessionPoolSnapshot(1)
    const primaryAccounts = snapshot.agents
      .map((agent) => agent.allocationChain.find((entry) => entry.allocationMode === 'primary')?.accountId)
      .filter((accountId): accountId is number => Number.isFinite(accountId))

    expect(new Set(primaryAccounts).size).toBe(2)
  })

  it('pins management-tier agents to codex/openai as primary while keeping fallback sessions available', async () => {
    createTempDbEnv()
    const {
      createSessionAccount,
      getDatabase,
      getSessionPoolSnapshot,
      listDispatchCandidatesForAgent,
      rebalanceSessionPool,
    } = await loadSessionPoolModules()

    const db = getDatabase()
    insertAgent(db, {
      name: 'Ops Commander',
      role: 'Team Lead - Operations',
      runtimeType: 'custom',
      preferredRuntime: 'openclaw',
      config: {
        taskRoutingTier: 'executive',
        model: {
          primary: 'openrouter/anthropic/claude-sonnet-4',
          fallbacks: ['openai/gpt-5.4'],
        },
      },
    })

    createSessionAccount(1, {
      label: 'OpenRouter Priority',
      provider: 'openrouter',
      runtimeType: 'openrouter',
      preferredModel: 'openrouter/anthropic/claude-sonnet-4',
      credentialRef: 'env:OPENROUTER_API_KEY',
      priority: 260,
      weight: 8,
    })
    createSessionAccount(1, {
      label: 'Codex Executive',
      provider: 'openai',
      runtimeType: 'codex',
      preferredModel: 'openai/gpt-5.4',
      credentialRef: 'codex-auth:executive',
      priority: 100,
      weight: 1,
    })

    rebalanceSessionPool(1)
    const snapshot = getSessionPoolSnapshot(1)
    const manager = snapshot.agents.find((agent) => agent.name === 'Ops Commander')

    expect(manager?.allocationChain[0]?.provider).toBe('openai')
    expect(manager?.allocationChain.map((entry) => entry.provider)).toEqual(['openai', 'openrouter'])

    const candidates = listDispatchCandidatesForAgent(1, manager!.id)
    expect(candidates[0]?.provider).toBe('openai')
  })
})
