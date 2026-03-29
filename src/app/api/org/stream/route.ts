import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { eventBus, ServerEvent } from '@/lib/event-bus'
import { getOrgSnapshot } from '@/lib/org-scanner'
import { orgWatcher } from '@/lib/org-watcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function encodeEvent(encoder: TextEncoder, type: string, data: unknown) {
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  orgWatcher.ensureStarted(auth.user.workspace_id ?? 1)
  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const workspaceId = auth.user.workspace_id ?? 1
      const initial = {
        type: 'connected',
        data: getOrgSnapshot({ workspaceId }),
        timestamp: Date.now(),
      }
      controller.enqueue(encodeEvent(encoder, 'connected', initial))

      const handler = (event: ServerEvent) => {
        if (event.type !== 'org.updated') return
        try {
          const payload = {
            type: 'org-update',
            data: getOrgSnapshot({ workspaceId }),
            timestamp: Date.now(),
          }
          controller.enqueue(encodeEvent(encoder, 'org-update', payload))
        } catch {
          // Cleaned up by cancel/abort.
        }
      }

      eventBus.on('server-event', handler)

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30_000)

      cleanup = () => {
        eventBus.off('server-event', handler)
        clearInterval(heartbeat)
      }
    },
    cancel() {
      if (cleanup) {
        cleanup()
        cleanup = null
      }
    },
  })

  request.signal.addEventListener(
    'abort',
    () => {
      if (cleanup) {
        cleanup()
        cleanup = null
      }
    },
    { once: true }
  )

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
