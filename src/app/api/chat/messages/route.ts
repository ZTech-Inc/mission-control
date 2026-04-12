import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, Message } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { getAllGatewaySessions, invalidateSessionCache } from '@/lib/sessions'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { scanForInjection, sanitizeForPrompt } from '@/lib/injection-guard'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { resolveCoordinatorDeliveryTarget } from '@/lib/coordinator-routing'

function getPreferredToolsProfile(): string {
  return String(process.env.OPENCLAW_TOOLS_PROFILE || 'coding').trim() || 'coding'
}

function isUnsupportedSessionsSpawnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase()
  const stderr = String((error as any)?.stderr || '').toLowerCase()
  return (
    (message.includes('unknown method') || stderr.includes('unknown method')) &&
    (message.includes('sessions_spawn') || stderr.includes('sessions_spawn'))
  )
}

type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
}

type ToolEvent = {
  name: string
  input?: string
  output?: string
  status?: string
}

type ChatAttachmentInput = {
  name?: string
  type?: string
  dataUrl?: string
}

const COORDINATOR_AGENT =
  String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').trim() ||
  'coordinator'
const LIVE_DIRECT_CONNECTION_WINDOW_SECONDS = 180

function parseGatewayJson(raw: string): any | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

function toGatewayAttachments(value: unknown): Array<{ type: 'image'; mimeType: string; fileName?: string; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined

  const attachments = value.flatMap((entry) => {
    const file = entry as ChatAttachmentInput
    if (!file || typeof file !== 'object' || typeof file.dataUrl !== 'string') return []
    const match = /^data:([^;]+);base64,(.+)$/.exec(file.dataUrl)
    if (!match) return []
    if (!match[1].startsWith('image/')) return []
    return [{
      type: 'image' as const,
      mimeType: match[1],
      fileName: typeof file.name === 'string' ? file.name : undefined,
      content: match[2],
    }]
  })

  return attachments.length > 0 ? attachments : undefined
}

function safeParseMetadata(raw: string | null | undefined): any | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function createChatReply(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' | 'tool_call' = 'status',
  metadata: Record<string, any> | null = null
) {
  const replyInsert = db
    .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversationId,
      fromAgent,
      toAgent,
      content,
      messageType,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId
    )

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(replyInsert.lastInsertRowid, workspaceId) as Message

  eventBus.broadcast('chat.message', {
    ...row,
    metadata: safeParseMetadata(row.metadata),
  })
}

function parseAgentConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function getConfigOpenClawId(raw: string | null | undefined): string | null {
  const parsed = parseAgentConfig(raw)
  return typeof parsed.openclawId === 'string' && parsed.openclawId.trim()
    ? parsed.openclawId.trim()
    : null
}

function collectStructuredText(value: unknown, parts: string[], depth = 0): void {
  if (depth > 8 || value == null) return

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) parts.push(trimmed)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStructuredText(item, parts, depth + 1)
    return
  }

  if (typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const blockType = String(record.type || '').toLowerCase()
  if (
    (blockType === 'text' || blockType === 'output_text' || blockType === 'input_text') &&
    typeof record.text === 'string'
  ) {
    const trimmed = record.text.trim()
    if (trimmed) parts.push(trimmed)
  }

  if (typeof record.content === 'string') {
    const trimmed = record.content.trim()
    if (trimmed) parts.push(trimmed)
  }

  const nestedCandidates = [
    record.content,
    record.message,
    record.messages,
    record.output,
    record.result,
    record.response,
    record.parts,
    record.items,
  ]

  for (const candidate of nestedCandidates) {
    if (candidate != null) collectStructuredText(candidate, parts, depth + 1)
  }
}

function extractHistoryMessageText(message: any): string | null {
  if (!message || typeof message !== 'object') return null

  const parts: string[] = []
  collectStructuredText(message.content, parts)
  if (parts.length > 0) return parts.join('\n').slice(0, 8000)

  if (typeof message.text === 'string' && message.text.trim()) {
    return message.text.trim().slice(0, 8000)
  }

  return null
}

async function getLatestAssistantReplyFromHistory(sessionKey: string | null | undefined): Promise<string | null> {
  const resolvedSessionKey = String(sessionKey || '').trim()
  if (!resolvedSessionKey) return null

  try {
    const historyPayload = await callOpenClawGateway<any>(
      'chat.history',
      {
        sessionKey: resolvedSessionKey,
        limit: 12,
      },
      10_000,
    )

    const messages = Array.isArray(historyPayload?.messages) ? historyPayload.messages : []
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (!message || typeof message !== 'object') continue
      if (String(message.role || '').toLowerCase() !== 'assistant') continue
      const text = extractHistoryMessageText(message)
      if (text) return text
    }
  } catch (err) {
    logger.warn({ err, sessionKey: resolvedSessionKey }, 'Failed to read chat history fallback')
  }

  return null
}

function extractReplyText(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  const directCandidates = [
    waitPayload.text,
    waitPayload.message,
    waitPayload.response,
    waitPayload.output,
    waitPayload.result,
  ]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  if (typeof waitPayload.output === 'object' && waitPayload.output) {
    const nested = [
      waitPayload.output.text,
      waitPayload.output.message,
      waitPayload.output.content,
    ]
    for (const value of nested) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  const structuredCandidates = [
    waitPayload.message,
    waitPayload.result?.message,
    waitPayload.response?.message,
    waitPayload.output?.message,
    waitPayload.final,
    waitPayload.result,
    waitPayload.response,
  ]

  for (const value of structuredCandidates) {
    const parts: string[] = []
    collectStructuredText(value, parts)
    if (parts.length > 0) return parts.join('\n').slice(0, 8000)
  }

  if (Array.isArray(waitPayload.output)) {
    const parts: string[] = []
    for (const item of waitPayload.output) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.text === 'string' && item.text.trim()) parts.push(item.text.trim())
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (!block || typeof block !== 'object') continue
          const blockType = String(block.type || '')
          if ((blockType === 'text' || blockType === 'output_text' || blockType === 'input_text') && typeof block.text === 'string' && block.text.trim()) {
            parts.push(block.text.trim())
          }
        }
      }
    }
    if (parts.length > 0) return parts.join('\n').slice(0, 8000)
  }

  const fallbackParts: string[] = []
  collectStructuredText(waitPayload.output, fallbackParts)
  if (fallbackParts.length > 0) return fallbackParts.join('\n').slice(0, 8000)

  return null
}

function normalizeToolEvent(raw: any): ToolEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || raw.tool || raw.toolName || raw.function || raw.call || '').trim()
  if (!name) return null

  const inputRaw = raw.input ?? raw.args ?? raw.arguments ?? raw.params
  const outputRaw = raw.output ?? raw.result ?? raw.response
  const statusRaw =
    raw.status ??
    (raw.isError === true ? 'error' : undefined) ??
    (raw.ok === false ? 'error' : undefined) ??
    (raw.success === true ? 'ok' : undefined)

  const input =
    typeof inputRaw === 'string'
      ? inputRaw.slice(0, 2000)
      : inputRaw !== undefined
        ? JSON.stringify(inputRaw).slice(0, 2000)
        : undefined
  const output =
    typeof outputRaw === 'string'
      ? outputRaw.slice(0, 4000)
      : outputRaw !== undefined
        ? JSON.stringify(outputRaw).slice(0, 4000)
        : undefined
  const status = statusRaw !== undefined ? String(statusRaw).slice(0, 60) : undefined
  return { name, input, output, status }
}

function extractToolEvents(waitPayload: any): ToolEvent[] {
  if (!waitPayload || typeof waitPayload !== 'object') return []

  const candidates = [
    waitPayload.toolCalls,
    waitPayload.tools,
    waitPayload.calls,
    waitPayload.events,
    waitPayload.output?.toolCalls,
    waitPayload.output?.tools,
    waitPayload.output?.events,
  ]

  const events: ToolEvent[] = []
  for (const list of candidates) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const evt = normalizeToolEvent(item)
      if (evt) events.push(evt)
      if (events.length >= 20) return events
    }
  }

  // OpenAI Responses-style output array
  if (Array.isArray(waitPayload.output)) {
    for (const item of waitPayload.output) {
      if (!item || typeof item !== 'object') continue
      const itemType = String(item.type || '').toLowerCase()
      if (itemType === 'function_call' || itemType === 'tool_call') {
        const evt = normalizeToolEvent({
          name: item.name || item.tool_name || item.toolName,
          arguments: item.arguments || item.input,
          output: item.output || item.result,
          status: item.status,
        })
        if (evt) events.push(evt)
      } else if (itemType === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          const blockType = String(block?.type || '').toLowerCase()
          if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'function_call') {
            const evt = normalizeToolEvent(block)
            if (evt) events.push(evt)
          }
        }
      }
      if (events.length >= 20) return events
    }
  }

  return events
}

/**
 * GET /api/chat/messages - List messages with filters
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    let query = 'SELECT * FROM messages WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (conversation_id) {
      query += ' AND conversation_id = ?'
      params.push(conversation_id)
    }

    if (from_agent) {
      query += ' AND from_agent = ?'
      params.push(from_agent)
    }

    if (to_agent) {
      query += ' AND to_agent = ?'
      params.push(to_agent)
    }

    if (since) {
      query += ' AND created_at > ?'
      params.push(parseInt(since))
    }

    query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const messages = db.prepare(query).all(...params) as Message[]

    const parsed = messages.map((msg) => ({
      ...msg,
      metadata: safeParseMetadata(msg.metadata),
    }))

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE workspace_id = ?'
    const countParams: any[] = [workspaceId]
    if (conversation_id) {
      countQuery += ' AND conversation_id = ?'
      countParams.push(conversation_id)
    }
    if (from_agent) {
      countQuery += ' AND from_agent = ?'
      countParams.push(from_agent)
    }
    if (to_agent) {
      countQuery += ' AND to_agent = ?'
      countParams.push(to_agent)
    }
    if (since) {
      countQuery += ' AND created_at > ?'
      countParams.push(parseInt(since))
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number }

    return NextResponse.json({ messages: parsed, total: countRow.total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

/**
 * POST /api/chat/messages - Send a new message
 * Body: { to, content, message_type, conversation_id, metadata }
 * Sender identity is always resolved server-side from authenticated user.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    const requestedFrom = typeof body.from === 'string' ? body.from.trim() : ''
    const isCoordinatorOverride = requestedFrom.toLowerCase() === COORDINATOR_AGENT.toLowerCase()
    const from = isCoordinatorOverride
      ? COORDINATOR_AGENT
      : (auth.user.display_name || auth.user.username || 'system')
    const to = body.to ? (body.to as string).trim() : null
    const content = (body.content || '').trim()
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const metadata = body.metadata || null

    if (!content) {
      return NextResponse.json(
        { error: '"content" is required' },
        { status: 400 }
      )
    }

    // Scan content for injection when it will be forwarded to an agent
    if (body.forward && to) {
      const injectionReport = scanForInjection(content, { context: 'prompt' })
      if (!injectionReport.safe) {
        const criticals = injectionReport.matches.filter(m => m.severity === 'critical')
        if (criticals.length > 0) {
          logger.warn({ to, rules: criticals.map(m => m.rule) }, 'Blocked chat message: injection detected')
          return NextResponse.json(
            { error: 'Message blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) },
            { status: 422 }
          )
        }
      }
    }

    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      conversation_id,
      from,
      to,
      content,
      message_type,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId
    )

    const messageId = result.lastInsertRowid as number

    let forwardInfo: ForwardInfo | null = null

    // Log activity
    db_helpers.logActivity(
      'chat_message',
      'message',
      messageId,
      from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type },
      workspaceId
    )

    // Create notification for recipient if specified
    if (to) {
      const messagePreview = content.substring(0, 200) + (content.length > 200 ? '...' : '')
      const enqueueNotification = (recipient: string) => {
        if (!recipient) return
        db_helpers.createNotification(
          recipient,
          'chat_message',
          `Message from ${from}`,
          messagePreview,
          'message',
          messageId,
          workspaceId
        )
      }

      enqueueNotification(to)

      // Optionally forward to agent via gateway
      if (body.forward) {
        forwardInfo = { attempted: true, delivered: false }

        const normalizedTo = String(to).trim().toLowerCase()
        const devAliasTarget =
          String(process.env.MC_DEV_ALIAS_TARGET || process.env.NEXT_PUBLIC_DEV_ALIAS_TARGET || 'codex-main').trim() ||
          'codex-main'
        const aliasAgent =
          normalizedTo === 'dev'
            ? (db
                .prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
                .get(devAliasTarget, workspaceId) as any)
            : null
        const deliveryTargetName = aliasAgent?.name ? String(aliasAgent.name) : String(to)

        const agent =
          aliasAgent ||
          (db
            .prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
            .get(deliveryTargetName, workspaceId) as any)

        if (aliasAgent?.name && aliasAgent.name.toLowerCase() !== normalizedTo) {
          enqueueNotification(String(aliasAgent.name))
        }

        const explicitSessionKey = typeof body.sessionKey === 'string' && body.sessionKey
          ? body.sessionKey
          : null
        const sessions = getAllGatewaySessions()
        const isCoordinatorSend = String(to).toLowerCase() === COORDINATOR_AGENT.toLowerCase()
        const sessionLookupName = isCoordinatorSend ? String(to) : deliveryTargetName
        const allAgents = isCoordinatorSend
          ? (db
              .prepare('SELECT name, session_key, config FROM agents WHERE workspace_id = ?')
              .all(workspaceId) as Array<{ name: string; session_key?: string | null; config?: string | null }>)
          : []
        const configuredCoordinatorTarget = isCoordinatorSend
          ? (db
              .prepare("SELECT value FROM settings WHERE key = 'chat.coordinator_target_agent'")
              .get() as { value?: string } | undefined)?.value || null
          : null

        const coordinatorResolution = resolveCoordinatorDeliveryTarget({
          to: isCoordinatorSend ? String(to) : deliveryTargetName,
          coordinatorAgent: COORDINATOR_AGENT,
          directAgent: agent
            ? {
                name: String(agent.name || deliveryTargetName),
                session_key: typeof agent.session_key === 'string' ? agent.session_key : null,
                config: typeof agent.config === 'string' ? agent.config : null,
              }
            : null,
          allAgents,
          sessions,
          explicitSessionKey,
          configuredCoordinatorTarget,
        })

        // Use explicit session key from caller if provided, then DB, then on-disk lookup
        let sessionKey: string | null = coordinatorResolution.sessionKey
        const now = Math.floor(Date.now() / 1000)
        const liveDirectCutoff = now - LIVE_DIRECT_CONNECTION_WINDOW_SECONDS

        // Fallback: derive session from on-disk gateway session stores
        if (!sessionKey) {
          const match = sessions.find(
            (s) =>
              s.agent.toLowerCase() === sessionLookupName.toLowerCase() ||
              s.agent.toLowerCase() === coordinatorResolution.deliveryName.toLowerCase() ||
              s.agent.toLowerCase() === String(coordinatorResolution.openclawAgentId || '').toLowerCase()
          )
          sessionKey = match?.key || match?.sessionId || null
        }

        // Prefer configured openclawId when present, fallback to normalized name
        let openclawAgentId: string | null = coordinatorResolution.openclawAgentId
        const resolvedDeliveryAgent = db
          .prepare('SELECT id, name FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
          .get(coordinatorResolution.deliveryName, workspaceId) as { id: number; name: string } | undefined
        const fallbackConnectedCoordinatorAgent =
          isCoordinatorSend && !resolvedDeliveryAgent
            ? (db
                .prepare(
                  `SELECT a.id, a.name, dc.connection_id
                   FROM direct_connections dc
                   JOIN agents a ON a.id = dc.agent_id
                   WHERE dc.status = 'connected'
                     AND dc.workspace_id = ?
                     AND a.workspace_id = ?
                     AND COALESCE(dc.last_heartbeat, dc.updated_at) >= ?
                   ORDER BY dc.updated_at DESC
                   LIMIT 1`
                )
                .get(workspaceId, workspaceId, liveDirectCutoff) as { id: number; name: string; connection_id?: string } | undefined)
            : undefined
        const deliveryAgent = resolvedDeliveryAgent || fallbackConnectedCoordinatorAgent
        const activeDirectConnection = fallbackConnectedCoordinatorAgent?.connection_id
          ? ({ connection_id: fallbackConnectedCoordinatorAgent.connection_id } as { connection_id?: string })
          : deliveryAgent
          ? (db
              .prepare(
                `SELECT connection_id
                 FROM direct_connections
                 WHERE agent_id = ?
                   AND status = 'connected'
                   AND workspace_id = ?
                   AND COALESCE(last_heartbeat, updated_at) >= ?
                 ORDER BY updated_at DESC
                 LIMIT 1`
              )
              .get(deliveryAgent.id, workspaceId, liveDirectCutoff) as { connection_id?: string } | undefined)
          : undefined
        const statusAgentName =
          typeof agent?.name === 'string' && agent.name
            ? String(agent.name)
            : typeof deliveryAgent?.name === 'string' && deliveryAgent.name
            ? String(deliveryAgent.name)
            : coordinatorResolution.deliveryName
        const updateDeliveryAgentStatus = (
          status: 'offline' | 'idle' | 'busy' | 'error',
          activity: string,
        ) => {
          if (!statusAgentName) return
          try {
            db_helpers.updateAgentStatus(statusAgentName, status, activity, workspaceId)
          } catch (err) {
            logger.warn({ err, agent: statusAgentName, status }, 'Failed to update delivery agent status')
          }
        }
        const canFallbackToDirectQueue = Boolean(activeDirectConnection?.connection_id && deliveryAgent?.name)
        const listConnectedDirectAgents = () =>
          db
            .prepare(
              `SELECT a.name, dc.connection_id
               FROM direct_connections dc
               JOIN agents a ON a.id = dc.agent_id
               WHERE dc.status = 'connected'
                 AND dc.workspace_id = ?
                 AND a.workspace_id = ?
                 AND COALESCE(dc.last_heartbeat, dc.updated_at) >= ?
               ORDER BY dc.updated_at DESC`
            )
            .all(workspaceId, workspaceId, liveDirectCutoff) as Array<{ name?: string; connection_id?: string }>
        const markDirectQueueDelivery = (
          agentName: string | null | undefined,
          connectionId: string | null | undefined,
        ): boolean => {
          if (!forwardInfo) return false
          const resolvedAgentName = String(agentName || '').trim()
          const resolvedConnectionId = String(connectionId || '').trim()
          if (!resolvedAgentName || !resolvedConnectionId) return false

          if (resolvedAgentName.toLowerCase() !== String(to).toLowerCase()) {
            enqueueNotification(resolvedAgentName)
          }
          forwardInfo.delivered = true
          forwardInfo.session = `direct:${resolvedConnectionId}`
          forwardInfo.reason = 'fallback_direct_queue'
          return true
        }

        if (!sessionKey && !canFallbackToDirectQueue) {
          const isTeamOrDeptChat =
            typeof conversation_id === 'string' &&
            (conversation_id.startsWith('team:') || conversation_id.startsWith('dept:'))

          if (isTeamOrDeptChat) {
            // Auto-spawn flow: start a session for the offline agent and surface its reply
            forwardInfo.attempted = true
            forwardInfo.reason = 'auto_spawn'

            try {
              createChatReply(
                db,
                workspaceId,
                conversation_id,
                String(to),
                from,
                'Spawning agent session...',
                'status',
                { status: 'spawning' }
              )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create spawning status reply')
            }

            try {
              const toolsProfile = getPreferredToolsProfile()
              const targetAgentId = openclawAgentId || getConfigOpenClawId(agent?.config) || deliveryTargetName
              const spawnPayload: Record<string, unknown> = {
                agentId: targetAgentId,
                task: content,
                label: 'chat-reply',
                runTimeoutSeconds: 120,
                tools: { profile: toolsProfile },
              }

              let spawnResult: any
              try {
                spawnResult = await callOpenClawGateway('sessions_spawn', spawnPayload, 15_000)
              } catch (firstError: any) {
                const rawErr = String(firstError?.message || '').toLowerCase()
                const isToolsSchemaError =
                  (rawErr.includes('unknown field') || rawErr.includes('unknown key') || rawErr.includes('invalid argument')) &&
                  (rawErr.includes('tools') || rawErr.includes('profile'))
                if (isToolsSchemaError) {
                  const fallbackPayload = { ...spawnPayload }
                  delete fallbackPayload.tools
                  spawnResult = await callOpenClawGateway('sessions_spawn', fallbackPayload, 15_000)
                } else if (isUnsupportedSessionsSpawnError(firstError) && targetAgentId) {
                  const invokeResult = await runOpenClaw(
                    [
                      'gateway',
                      'call',
                      'agent',
                      '--timeout',
                      '12000',
                      '--params',
                      JSON.stringify({
                        agentId: targetAgentId,
                        message: `Message from ${from}: ${content}`,
                        idempotencyKey: `mc-${messageId}-${Date.now()}`,
                        deliver: false,
                      }),
                      '--json',
                    ],
                    { timeoutMs: 15000 }
                  )
                  spawnResult = parseGatewayJson(invokeResult.stdout)
                } else {
                  throw firstError
                }
              }

              const spawnedSessionKey = spawnResult?.sessionId || spawnResult?.session_id || null
              const runId = spawnResult?.runId || spawnResult?.run_id || null

              forwardInfo.delivered = true
              forwardInfo.session = spawnedSessionKey || undefined
              forwardInfo.runId = runId || undefined
              updateDeliveryAgentStatus('busy', 'Processing team chat message')

              // Invalidate session cache so subsequent messages find the new session
              try { invalidateSessionCache() } catch {}

              if (runId) {
                const replyAgentName = String(to || 'agent').trim() || 'agent'
                try {
                  const waitResult = await runOpenClaw(
                    [
                      'gateway',
                      'call',
                      'agent.wait',
                      '--timeout',
                      '8000',
                      '--params',
                      JSON.stringify({ runId, timeoutMs: 6000 }),
                      '--json',
                    ],
                    { timeoutMs: 9000 }
                  )

                  const waitPayload = parseGatewayJson(waitResult.stdout)
                  const waitStatus = String(waitPayload?.status || '').toLowerCase()
                  const toolEvents = extractToolEvents(waitPayload)

                  if (toolEvents.length > 0) {
                    for (const evt of toolEvents) {
                      createChatReply(
                        db,
                        workspaceId,
                        conversation_id,
                        replyAgentName,
                        from,
                        evt.name,
                        'tool_call',
                        {
                          event: 'tool_call',
                          toolName: evt.name,
                          input: evt.input || null,
                          output: evt.output || null,
                          status: evt.status || null,
                          runId: runId || null,
                        }
                      )
                    }
                  }

                  if (waitStatus === 'error') {
                    const reason =
                      typeof waitPayload?.error === 'string'
                        ? waitPayload.error
                        : 'Unknown runtime error'
                    updateDeliveryAgentStatus('error', `Team chat execution failed: ${reason}`)
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      replyAgentName,
                      from,
                      `Execution failed: ${reason}`,
                      'status',
                      { status: 'error', runId }
                    )
                  } else if (waitStatus === 'timeout') {
                    updateDeliveryAgentStatus('busy', 'Processing team chat message')
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      replyAgentName,
                      from,
                      'Request accepted and still processing. A textual response was not available yet.',
                      'status',
                      { status: 'processing', runId }
                    )
                  } else {
                    const replyText =
                      extractReplyText(waitPayload) ||
                      await getLatestAssistantReplyFromHistory(spawnedSessionKey)
                    updateDeliveryAgentStatus('idle', 'Replied in team chat')
                    if (replyText) {
                      createChatReply(
                        db,
                        workspaceId,
                        conversation_id,
                        replyAgentName,
                        from,
                        replyText,
                        'text',
                        { status: waitStatus || 'completed', runId }
                      )
                    } else {
                      createChatReply(
                        db,
                        workspaceId,
                        conversation_id,
                        replyAgentName,
                        from,
                        'Execution completed, but no textual response was returned.',
                        'status',
                        { status: waitStatus || 'completed', runId }
                      )
                    }
                  }
                } catch (waitErr) {
                  updateDeliveryAgentStatus('busy', 'Processing team chat message')
                  logger.warn({ err: waitErr, runId }, 'Auto-spawn wait/readback failed')
                }
              }
            } catch (spawnErr: any) {
              updateDeliveryAgentStatus('error', 'Team chat auto-spawn failed')
              logger.error({ err: spawnErr, to, conversation_id }, 'Auto-spawn failed')
              try {
                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  String(to),
                  from,
                  'Failed to auto-spawn agent session. Please try again or start a session manually.',
                  'status',
                  { status: 'spawn_failed' }
                )
              } catch (e) {
                logger.error({ err: e }, 'Failed to create spawn-failed status reply')
              }
            }
          } else {
            forwardInfo.reason = 'no_active_session'

            // For coordinator messages, emit an immediate visible status reply
            if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
              try {
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.',
                    'status',
                    { status: 'offline', reason: 'no_active_session' }
                  )
              } catch (e) {
                logger.error({ err: e }, 'Failed to create offline status reply')
              }
            } else if (typeof conversation_id === 'string') {
              try {
                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  String(to),
                  from,
                  'Message received, but no live runtime session is available right now.',
                  'status',
                  { status: 'offline', reason: 'no_active_session' }
                )
              } catch (e) {
                logger.error({ err: e }, 'Failed to create non-coordinator offline status reply')
              }
            }
          }
        } else {
          try {
            const idempotencyKey = `mc-${messageId}-${Date.now()}`

            if (sessionKey) {
              const acceptedPayload = await callOpenClawGateway<any>(
                'chat.send',
                {
                  sessionKey,
                  message: content,
                  idempotencyKey,
                  deliver: false,
                  attachments: toGatewayAttachments(body.attachments),
                },
                12000,
              )
              const status = String(acceptedPayload?.status || '').toLowerCase()
              forwardInfo.delivered = status === 'started' || status === 'ok' || status === 'in_flight'
              forwardInfo.session = sessionKey
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
              if (forwardInfo.delivered) {
                updateDeliveryAgentStatus('busy', 'Processing chat message')
              }
            } else if (canFallbackToDirectQueue && deliveryAgent?.name) {
              markDirectQueueDelivery(deliveryAgent.name, activeDirectConnection?.connection_id)
            } else if (openclawAgentId) {
              const invokeParams: any = {
                message: `Message from ${from}: ${content}`,
                idempotencyKey,
                deliver: false,
              }
              invokeParams.agentId = openclawAgentId

              const invokeResult = await runOpenClaw(
                [
                  'gateway',
                  'call',
                  'agent',
                  '--timeout',
                  '10000',
                  '--params',
                  JSON.stringify(invokeParams),
                  '--json',
                ],
                { timeoutMs: 12000 }
              )
              const acceptedPayload = parseGatewayJson(invokeResult.stdout)
              forwardInfo.delivered = true
              forwardInfo.session = openclawAgentId || undefined
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
              updateDeliveryAgentStatus('busy', 'Processing chat message')
            }
          } catch (err) {
            // OpenClaw may return accepted JSON on stdout but still emit a late stderr warning.
            // Treat accepted runs as successful delivery.
            const errAny = err as any
            const gatewayCliUnavailable =
              String(errAny?.code || '') === 'ENOENT' &&
              /openclaw|clawdbot/i.test(String(errAny?.path || ''))
            const maybeStdout = String((err as any)?.stdout || '')
            const acceptedPayload = parseGatewayJson(maybeStdout)
            if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
              forwardInfo.delivered = true
              forwardInfo.session = sessionKey || openclawAgentId || undefined
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
              updateDeliveryAgentStatus('busy', 'Processing chat message')
            } else if (canFallbackToDirectQueue && deliveryAgent?.name) {
              markDirectQueueDelivery(deliveryAgent.name, activeDirectConnection?.connection_id)
              logger.warn(
                { err, to, deliveryAgent: deliveryAgent.name },
                'Gateway delivery failed, falling back to direct-connection notification queue'
              )
            } else {
              let recoveredByDirectQueue = false
              if (isCoordinatorSend) {
                const emergencyFallback = listConnectedDirectAgents()[0]
                recoveredByDirectQueue = markDirectQueueDelivery(
                  emergencyFallback?.name,
                  emergencyFallback?.connection_id,
                )
                if (recoveredByDirectQueue) {
                  logger.warn(
                    { err, to, deliveryAgent: emergencyFallback?.name || null },
                    'Recovered coordinator delivery via emergency direct-connection queue fallback'
                  )
                }
              } else {
                // Alias fallback for non-coordinator targets (e.g. "Dev") when there is
                // exactly one connected direct agent and gateway delivery is unavailable.
                const connectedAgents = listConnectedDirectAgents()
                if (connectedAgents.length === 1) {
                  recoveredByDirectQueue = markDirectQueueDelivery(
                    connectedAgents[0]?.name,
                    connectedAgents[0]?.connection_id,
                  )
                  if (recoveredByDirectQueue) {
                    logger.warn(
                      { err, to, deliveryAgent: connectedAgents[0]?.name || null },
                      'Recovered delivery via single connected direct-agent alias fallback'
                    )
                  }
                }
              }
              if (!recoveredByDirectQueue) {
                forwardInfo.reason = gatewayCliUnavailable ? 'gateway_unavailable' : 'gateway_send_failed'
                logger.error(
                  { err },
                  gatewayCliUnavailable
                    ? 'Gateway delivery unavailable: openclaw CLI is not installed or not in PATH'
                    : 'Failed to forward message via gateway'
                )

                // For coordinator messages, emit visible status when send fails
                if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
                  try {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      gatewayCliUnavailable
                        ? 'I received your message, but coordinator runtime delivery is unavailable on this host (openclaw CLI not found). Connect a live direct agent or install/configure OpenClaw gateway tooling.'
                        : 'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.',
                      'status',
                      { status: 'delivery_failed', reason: forwardInfo.reason }
                    )
                  } catch (e) {
                    logger.error({ err: e }, 'Failed to create gateway failure status reply')
                  }
                } else if (typeof conversation_id === 'string') {
                  try {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      String(to),
                      from,
                      gatewayCliUnavailable
                        ? 'Message delivery is unavailable on this host (openclaw CLI not found).'
                        : 'Message delivery failed for the live runtime session.',
                      'status',
                      { status: 'delivery_failed', reason: forwardInfo.reason }
                    )
                  } catch (e) {
                    logger.error({ err: e }, 'Failed to create non-coordinator failure status reply')
                  }
                }
              }
            }
          }

          // Coordinator mode should always show visible coordinator feedback in thread.
          if (
            typeof conversation_id === 'string' &&
            conversation_id.startsWith('coord:') &&
            forwardInfo.delivered
          ) {
            try {
              createChatReply(
                db,
                workspaceId,
                conversation_id,
                COORDINATOR_AGENT,
                from,
                'Received. I am coordinating downstream agents now.',
                'status',
                { status: 'accepted', runId: forwardInfo.runId || null }
              )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create accepted status reply')
            }

            // Best effort: wait briefly and surface completion/error feedback.
            if (forwardInfo.runId) {
              try {
                const waitResult = await runOpenClaw(
                  [
                    'gateway',
                    'call',
                    'agent.wait',
                    '--timeout',
                    '8000',
                    '--params',
                    JSON.stringify({ runId: forwardInfo.runId, timeoutMs: 6000 }),
                    '--json',
                  ],
                  { timeoutMs: 9000 }
                )

                const waitPayload = parseGatewayJson(waitResult.stdout)
                const waitStatus = String(waitPayload?.status || '').toLowerCase()
                const toolEvents = extractToolEvents(waitPayload)

                if (toolEvents.length > 0) {
                  for (const evt of toolEvents) {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      evt.name,
                      'tool_call',
                      {
                        event: 'tool_call',
                        toolName: evt.name,
                        input: evt.input || null,
                        output: evt.output || null,
                        status: evt.status || null,
                        runId: forwardInfo.runId || null,
                      }
                    )
                  }
                }

                if (waitStatus === 'error') {
                  const reason =
                    typeof waitPayload?.error === 'string'
                      ? waitPayload.error
                      : 'Unknown runtime error'
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    `I received your message, but execution failed: ${reason}`,
                    'status',
                    { status: 'error', runId: forwardInfo.runId }
                  )
                } else if (waitStatus === 'timeout') {
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    'I received your message and I am still processing it. I will post results as soon as execution completes.',
                    'status',
                    { status: 'processing', runId: forwardInfo.runId }
                  )
                } else {
                  const replyText =
                    extractReplyText(waitPayload) ||
                    await getLatestAssistantReplyFromHistory(forwardInfo.session)
                  if (replyText) {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      replyText,
                      'text',
                      { status: waitStatus || 'completed', runId: forwardInfo.runId }
                    )
                  } else {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      'Execution accepted and completed. No textual response payload was returned by the runtime.',
                      'status',
                      { status: waitStatus || 'completed', runId: forwardInfo.runId }
                    )
                  }
                }
              } catch (waitErr) {
                const maybeWaitStdout = String((waitErr as any)?.stdout || '')
                const maybeWaitStderr = String((waitErr as any)?.stderr || '')
                const waitPayload = parseGatewayJson(maybeWaitStdout)
                const reason =
                  typeof waitPayload?.error === 'string'
                    ? waitPayload.error
                    : (maybeWaitStderr || maybeWaitStdout || 'Unable to read completion status from coordinator runtime.').trim()

                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  COORDINATOR_AGENT,
                  from,
                  `I received your message, but I could not retrieve completion output yet: ${reason}`,
                  'status',
                  { status: 'unknown', runId: forwardInfo.runId }
                )
              }
            }
          }

          // For non-coordinator direct messages, mirror runtime replies back into the same thread.
          if (
            typeof conversation_id === 'string' &&
            !conversation_id.startsWith('coord:') &&
            forwardInfo.delivered &&
            forwardInfo.runId
          ) {
            const replyAgentName = String(to || 'agent').trim() || 'agent'
            try {
              const waitResult = await runOpenClaw(
                [
                  'gateway',
                  'call',
                  'agent.wait',
                  '--timeout',
                  '8000',
                  '--params',
                  JSON.stringify({ runId: forwardInfo.runId, timeoutMs: 6000 }),
                  '--json',
                ],
                { timeoutMs: 9000 }
              )

              const waitPayload = parseGatewayJson(waitResult.stdout)
              const waitStatus = String(waitPayload?.status || '').toLowerCase()

              if (waitStatus === 'error') {
                const reason =
                  typeof waitPayload?.error === 'string'
                    ? waitPayload.error
                    : 'Unknown runtime error'
                updateDeliveryAgentStatus('error', `Chat execution failed: ${reason}`)
                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  replyAgentName,
                  from,
                  `Execution failed: ${reason}`,
                  'status',
                  { status: 'error', runId: forwardInfo.runId }
                )
              } else if (waitStatus === 'timeout') {
                updateDeliveryAgentStatus('busy', 'Processing chat message')
                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  replyAgentName,
                  from,
                  'Request accepted and still processing. A textual response was not available yet.',
                  'status',
                  { status: 'processing', runId: forwardInfo.runId }
                )
              } else {
                const replyText =
                  extractReplyText(waitPayload) ||
                  await getLatestAssistantReplyFromHistory(forwardInfo.session)
                updateDeliveryAgentStatus('idle', 'Replied in chat')
                if (replyText) {
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    replyAgentName,
                    from,
                    replyText,
                    'text',
                    { status: waitStatus || 'completed', runId: forwardInfo.runId }
                  )
                } else {
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    replyAgentName,
                    from,
                    'Execution completed, but no textual response payload was returned.',
                    'status',
                    { status: waitStatus || 'completed', runId: forwardInfo.runId }
                  )
                }
              }
            } catch (waitErr) {
              updateDeliveryAgentStatus('busy', 'Processing chat message')
              logger.warn({ err: waitErr, runId: forwardInfo.runId }, 'Non-coordinator wait/readback failed')
            }
          }
        }
      }
    }

    const created = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?').get(messageId, workspaceId) as Message
    const parsedMessage = {
      ...created,
      metadata: {
        ...(safeParseMetadata(created.metadata) || {}),
        forwardInfo: forwardInfo || undefined,
      },
    }

    // Broadcast to SSE clients
    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json({ message: parsedMessage, forward: forwardInfo }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
