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
    members: snapshot.agentAssignments.filter((assignment) => assignment.team_id === Number(id)),
    source: snapshot.source,
    scannedAt: snapshot.scannedAt,
  })
}

export async function POST(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
