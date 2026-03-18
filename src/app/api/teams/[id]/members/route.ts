import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { MOCK_AGENT_ASSIGNMENTS } from '@/lib/mock-org-data'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  return NextResponse.json({ members: MOCK_AGENT_ASSIGNMENTS.filter(a => a.team_id === Number(id)) })
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
