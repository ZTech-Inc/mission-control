import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const runOpenClaw = vi.fn()
const getAllGatewaySessions = vi.fn()
const invalidateSessionCache = vi.fn()
const broadcast = vi.fn()
const scanForInjection = vi.fn()
const sanitizeForPrompt = vi.fn((value) => value)
const callOpenClawGateway = vi.fn()
const resolveCoordinatorDeliveryTarget = vi.fn()
const ensureOpenClawAgent = vi.fn()
const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}

const logActivity = vi.fn()
const createNotification = vi.fn()
const updateAgentStatus = vi.fn()

let messages: any[] = []
let prepare: ReturnType<typeof vi.fn>

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/command', () => ({
  runOpenClaw,
}))

vi.mock('@/lib/sessions', () => ({
  getAllGatewaySessions,
  invalidateSessionCache,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast,
  },
}))

vi.mock('@/lib/logger', () => ({
  logger,
}))

vi.mock('@/lib/injection-guard', () => ({
  scanForInjection,
  sanitizeForPrompt,
}))

vi.mock('@/lib/openclaw-gateway', () => ({
  callOpenClawGateway,
}))

vi.mock('@/lib/coordinator-routing', () => ({
  resolveCoordinatorDeliveryTarget,
}))

vi.mock('@/lib/openclaw-agent-provision', () => ({
  ensureOpenClawAgent,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  db_helpers: {
    logActivity,
    createNotification,
    updateAgentStatus,
  },
}))

describe('POST /api/chat/messages', () => {
  beforeEach(() => {
    vi.resetModules()
    messages = []
    requireRole.mockReturnValue({ user: { id: 1, username: 'heisen', display_name: 'heisen', role: 'operator', workspace_id: 1 } })
    getAllGatewaySessions.mockReturnValue([])
    invalidateSessionCache.mockReset()
    scanForInjection.mockReturnValue({ safe: true, matches: [] })
    callOpenClawGateway.mockReset()
    runOpenClaw.mockReset()
    resolveCoordinatorDeliveryTarget.mockImplementation(({ directAgent, to }) => ({
      deliveryName: directAgent?.name || String(to),
      sessionKey: null,
      openclawAgentId: 'finance-manager',
      resolvedBy: 'direct',
    }))
    ensureOpenClawAgent.mockImplementation(async ({ agentId, agentName }) => ({
      agentId: String(agentId || agentName || 'agent').toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      created: false,
      workspace: null,
    }))
    logActivity.mockReset()
    createNotification.mockReset()
    updateAgentStatus.mockReset()
    broadcast.mockReset()
    prepare = vi.fn((sql: string) => {
      if (sql.includes('INSERT INTO messages')) {
        return {
          run: (
            conversation_id: string,
            from_agent: string,
            to_agent: string | null,
            content: string,
            message_type: string,
            metadata: string | null,
            workspace_id: number,
          ) => {
            const row = {
              id: messages.length + 1,
              conversation_id,
              from_agent,
              to_agent,
              content,
              message_type,
              metadata,
              workspace_id,
              created_at: 1_700_000_000 + messages.length,
            }
            messages.push(row)
            return { lastInsertRowid: row.id }
          },
        }
      }

      if (sql.includes('SELECT * FROM messages WHERE id = ?')) {
        return {
          get: (id: number, workspaceId: number) => messages.find((row) => row.id === id && row.workspace_id === workspaceId),
        }
      }

      if (sql.includes('SELECT * FROM agents WHERE lower(name) = lower(?)')) {
        return {
          get: (name: string, workspaceId: number) =>
            workspaceId === 1 && String(name).toLowerCase() === 'finance-manager'
              ? {
                  id: 42,
                  name: 'finance-manager',
                  role: 'lead',
                  status: 'offline',
                  config: JSON.stringify({ openclawId: 'finance-manager' }),
                  session_key: null,
                }
              : workspaceId === 1 && String(name).toLowerCase() === 'agent evaluation specialist'
              ? {
                  id: 23,
                  name: 'Agent Evaluation Specialist',
                  role: 'specialist',
                  status: 'offline',
                  config: '{}',
                  session_key: null,
                  openclaw_id: null,
                }
              : undefined,
        }
      }

      if (sql.includes('SELECT * FROM agents WHERE id = ? AND workspace_id = ?')) {
        return {
          get: (id: number, workspaceId: number) =>
            workspaceId === 1 && Number(id) === 42
              ? {
                  id: 42,
                  name: 'finance-manager',
                  role: 'lead',
                  status: 'offline',
                  config: JSON.stringify({ openclawId: 'finance-manager' }),
                  session_key: null,
                }
              : workspaceId === 1 && Number(id) === 23
              ? {
                  id: 23,
                  name: 'Agent Evaluation Specialist',
                  role: 'specialist',
                  status: 'offline',
                  config: '{}',
                  session_key: null,
                  openclaw_id: null,
                }
              : undefined,
        }
      }

      if (sql.includes('SELECT id, name FROM agents WHERE lower(name) = lower(?)')) {
        return {
          get: (name: string, workspaceId: number) =>
            workspaceId === 1 && String(name).toLowerCase() === 'finance-manager'
              ? { id: 42, name: 'finance-manager' }
              : undefined,
        }
      }

      if (sql.includes('FROM direct_connections')) {
        return {
          get: () => undefined,
          all: () => [],
        }
      }

      throw new Error(`Unexpected SQL: ${sql}`)
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('auto-spawns the targeted offline team agent, updates presence, and persists structured final text', async () => {
    callOpenClawGateway.mockResolvedValue({
      sessionId: 'agent:finance-manager:main',
      runId: 'run-123',
    })
    runOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({
        status: 'completed',
        result: {
          message: {
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Frontend Team is online and responding.' },
            ],
          },
        },
      }),
    })

    const { POST } = await import('@/app/api/chat/messages/route')
    const request = new NextRequest('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'human',
        to: 'finance-manager',
        content: 'hi',
        conversation_id: 'team:5:agent:42',
        message_type: 'text',
        forward: true,
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(callOpenClawGateway).toHaveBeenCalledWith(
      'sessions_spawn',
      expect.objectContaining({
        agentId: 'finance-manager',
        task: 'hi',
        label: 'chat-reply',
      }),
      15_000,
    )
    expect(updateAgentStatus).toHaveBeenNthCalledWith(1, 'finance-manager', 'busy', 'Processing team chat message', 1)
    expect(updateAgentStatus).toHaveBeenNthCalledWith(2, 'finance-manager', 'idle', 'Replied in team chat', 1)
    expect(messages.map((row) => row.content)).toContain('Frontend Team is online and responding.')
    expect(messages.map((row) => row.content)).not.toContain('Execution completed, but no textual response was returned.')
    expect(body.forward).toMatchObject({
      attempted: true,
      delivered: true,
      reason: 'auto_spawn',
      session: 'agent:finance-manager:main',
      runId: 'run-123',
    })
  })

  it('falls back to chat history when agent.wait returns only status metadata', async () => {
    callOpenClawGateway
      .mockResolvedValueOnce({
        sessionId: 'agent:finance-manager:main',
        runId: 'run-456',
      })
      .mockResolvedValueOnce({
        sessionKey: 'agent:finance-manager:main',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'hi' }],
          },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '' },
              { type: 'text', text: 'History fallback reply.' },
            ],
          },
        ],
      })
    runOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({
        status: 'ok',
        runId: 'run-456',
      }),
    })

    const { POST } = await import('@/app/api/chat/messages/route')
    const request = new NextRequest('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'human',
        to: 'finance-manager',
        content: 'hi',
        conversation_id: 'team:5:agent:42',
        message_type: 'text',
        forward: true,
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(callOpenClawGateway).toHaveBeenNthCalledWith(
      2,
      'chat.history',
      {
        sessionKey: 'agent:finance-manager:main',
        limit: 12,
      },
      10_000,
    )
    expect(messages.map((row) => row.content)).toContain('History fallback reply.')
    expect(messages.map((row) => row.content)).not.toContain('Execution completed, but no textual response was returned.')
  })

  it('does not call gateway agent fallback with synthesized slug ids', async () => {
    resolveCoordinatorDeliveryTarget.mockImplementation(() => ({
      deliveryName: 'Agent Evaluation Specialist',
      sessionKey: null,
      openclawAgentId: 'agent-evaluation-specialist',
      resolvedBy: 'direct',
    }))
    callOpenClawGateway.mockRejectedValue(new Error('unknown method sessions_spawn'))

    const { POST } = await import('@/app/api/chat/messages/route')
    const request = new NextRequest('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'human',
        to: 'Agent Evaluation Specialist',
        content: 'gello',
        conversation_id: 'team:934278768:agent:23',
        message_type: 'text',
        forward: true,
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(runOpenClaw).not.toHaveBeenCalledWith(
      expect.arrayContaining(['gateway', 'call', 'agent']),
      expect.anything(),
    )
    expect(messages.map((row) => row.content)).toContain(
      'Failed to auto-spawn agent session. Please try again or start a session manually.',
    )
  })
})
