import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrgSnapshot, invalidateOrgSnapshot } from '@/lib/org-scanner'
import { orgWatcher } from '@/lib/org-watcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  orgWatcher.ensureStarted(auth.user.workspace_id ?? 1)
  const force = new URL(request.url).searchParams.get('force') === 'true'
  if (force) invalidateOrgSnapshot()

  return NextResponse.json(
    getOrgSnapshot({
      force,
      workspaceId: auth.user.workspace_id ?? 1,
    })
  )
}
