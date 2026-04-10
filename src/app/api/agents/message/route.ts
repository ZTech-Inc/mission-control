import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { validateBody, createMessageSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { scanForInjection } from '@/lib/injection-guard'
import { scanForSecrets } from '@/lib/secret-scanner'
import { logSecurityEvent } from '@/lib/security-events'
import { getAllGatewaySessions } from '@/lib/sessions'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'

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

function getAgentOpenclawId(agent: any): string | null {
  try {
    const cfg = typeof agent?.config === 'string' ? JSON.parse(agent.config) : agent?.config
    const id = typeof cfg?.openclawId === 'string' ? cfg.openclawId.trim() : ''
    return id || null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createMessageSchema)
    if ('error' in result) return result.error
    const { to, message } = result.data
    const from = auth.user.display_name || auth.user.username || 'system'

    // Scan message for injection — this gets forwarded directly to an agent
    const injectionReport = scanForInjection(message, { context: 'prompt' })
    if (!injectionReport.safe) {
      const criticals = injectionReport.matches.filter(m => m.severity === 'critical')
      if (criticals.length > 0) {
        logger.warn({ to, rules: criticals.map(m => m.rule) }, 'Blocked agent message: injection detected')
        return NextResponse.json(
          { error: 'Message blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) },
          { status: 422 }
        )
      }
    }

    const secretHits = scanForSecrets(message)
    if (secretHits.length > 0) {
      try { logSecurityEvent({ event_type: 'secret_exposure', severity: 'critical', source: 'agent-message', agent_name: from, detail: JSON.stringify({ count: secretHits.length, types: secretHits.map(s => s.type) }), workspace_id: auth.user.workspace_id ?? 1, tenant_id: 1 }) } catch {}
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1;
    const normalizedTo = String(to || '').trim().toLowerCase()
    const devAliasTarget =
      String(process.env.MC_DEV_ALIAS_TARGET || process.env.NEXT_PUBLIC_DEV_ALIAS_TARGET || 'codex-main').trim() ||
      'codex-main'
    const now = Math.floor(Date.now() / 1000)
    const liveCutoff = now - LIVE_DIRECT_CONNECTION_WINDOW_SECONDS
    const aliasAgent =
      normalizedTo === 'dev'
        ? (db
            .prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
            .get(devAliasTarget, workspaceId) as any)
        : null
    const lookupName = aliasAgent?.name ? String(aliasAgent.name) : to
    const agent =
      aliasAgent ||
      (db
        .prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?')
        .get(lookupName, workspaceId) as any)
    if (!agent) {
      return NextResponse.json({ error: 'Recipient agent not found' }, { status: 404 })
    }
    const activeDirectConnection = db
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
      .get(agent.id, workspaceId, liveCutoff) as { connection_id?: string } | undefined

    let deliveryMode: 'gateway-session' | 'gateway-agent' | 'direct-connection-queue' | 'queued-offline' = 'queued-offline'
    const openclawId = getAgentOpenclawId(agent)
    const sessions = getAllGatewaySessions()
    const discoveredSession = sessions.find((s) => {
      const candidate = String(s.agent || '').toLowerCase()
      return candidate === String(agent.name || '').toLowerCase() || candidate === String(openclawId || '').toLowerCase()
    })
    const effectiveSessionKey = typeof agent.session_key === 'string' && agent.session_key.trim()
      ? agent.session_key.trim()
      : (discoveredSession?.key || null)
    const idempotencyKey = `mc-agent-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    if (effectiveSessionKey) {
      try {
        const acceptedPayload = await callOpenClawGateway<any>(
          'chat.send',
          {
            sessionKey: effectiveSessionKey,
            message: `Message from ${from}: ${message}`,
            idempotencyKey,
            deliver: false,
          },
          12000,
        )
        const status = String(acceptedPayload?.status || '').toLowerCase()
        if (status === 'started' || status === 'ok' || status === 'in_flight' || status === 'accepted' || !status) {
          deliveryMode = 'gateway-session'
        } else {
          throw new Error(`Unexpected gateway status: ${status}`)
        }
      } catch (err) {
        if (activeDirectConnection?.connection_id) {
          logger.warn(
            { err, to },
            'Gateway session delivery failed, falling back to direct-connection notification queue'
          )
          deliveryMode = 'direct-connection-queue'
        } else {
          logger.warn(
            { err, to },
            'Gateway session delivery failed and no direct connection is active; queueing message for offline agent'
          )
          if (openclawId) {
            try {
              const invokeParams: any = {
                message: `Message from ${from}: ${message}`,
                idempotencyKey,
                deliver: false,
                agentId: openclawId,
              }
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
              if (acceptedPayload) {
                deliveryMode = 'gateway-agent'
              } else {
                deliveryMode = 'queued-offline'
              }
            } catch {
              deliveryMode = 'queued-offline'
            }
          } else {
            deliveryMode = 'queued-offline'
          }
        }
      }
    } else if (activeDirectConnection?.connection_id) {
      deliveryMode = 'direct-connection-queue'
    } else if (openclawId) {
      try {
        const invokeParams: any = {
          message: `Message from ${from}: ${message}`,
          idempotencyKey,
          deliver: false,
          agentId: openclawId,
        }
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
        deliveryMode = acceptedPayload ? 'gateway-agent' : 'queued-offline'
      } catch {
        deliveryMode = 'queued-offline'
      }
    }

    db_helpers.createNotification(
      String(agent.name || to),
      'message',
      'Direct Message',
      `${from}: ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}`,
      'agent',
      agent.id,
      workspaceId
    )

    db_helpers.logActivity(
      'agent_message',
      'agent',
      agent.id,
      from,
      `Sent message to ${String(agent.name || to)}`,
      { to, resolvedRecipient: String(agent.name || to), deliveryMode },
      workspaceId
    )

    return NextResponse.json({ success: true, deliveryMode, queued: deliveryMode === 'queued-offline' })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/message error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
