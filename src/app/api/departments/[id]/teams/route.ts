import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrgSnapshot } from '@/lib/org-scanner'
import { orgWatcher } from '@/lib/org-watcher'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  orgWatcher.ensureStarted(auth.user.workspace_id ?? 1)
  const snapshot = getOrgSnapshot({ workspaceId: auth.user.workspace_id ?? 1 })
  return NextResponse.json({
    teams: snapshot.teams.filter((team) => team.department_id === Number(id)),
    source: snapshot.source,
    scannedAt: snapshot.scannedAt,
  })
}
