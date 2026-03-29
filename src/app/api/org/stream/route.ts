import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { eventBus, ServerEvent } from '@/lib/event-bus'
import { getOrgSnapshot } from '@/lib/org-scanner'
import { orgWatcher } from '@/lib/org-watcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  orgWatcher.ensureStarted(auth.user.workspace_id ?? 1)
  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const initial = {
        type: 'connected',
        data: getOrgSnapshot({ workspaceId: auth.user.workspace_id ?? 1 }),
        timestamp: Date.now(),
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initial)}\n\n`))

      const handler = (event: ServerEvent) => {
        if (event.type !== 'org.updated') return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
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
