import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrgData, buildDocTree } from '@/lib/ztech-scanner'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const teamId = Number(id)
  const { teams, orgAgents } = getOrgData()
  const team = teams.find(t => t.id === teamId)
  if (!team) return NextResponse.json({ docs: [] })

  // Derive dir names from an agent's dir_path (format: deptDirName/teamDirName/agentDirName)
  const agentInTeam = orgAgents.find(a => a.team_id === teamId)
  if (!agentInTeam) return NextResponse.json({ docs: [] })

  const parts = agentInTeam.dir_path.split('/')
  const deptDirName = parts[0]
  const teamDirName = parts[1]
  if (!deptDirName || !teamDirName) return NextResponse.json({ docs: [] })

  const docs = buildDocTree(deptDirName, teamDirName)
  return NextResponse.json({ docs })
}

export async function POST(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
