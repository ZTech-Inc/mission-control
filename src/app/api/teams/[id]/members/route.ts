import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrgData } from '@/lib/ztech-scanner'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const teamId = Number(id)
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const { agentTeamAssignments, orgAgents } = getOrgData()

  const members = agentTeamAssignments
    .filter(a => a.team_id === teamId)
    .map(a => {
      const agent = orgAgents.find(o => o.id === a.agent_id)
      return {
        ...a,
        agent_name: agent?.name,
        agent_title: agent?.role,
      }
    })

  return NextResponse.json({ members })
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
