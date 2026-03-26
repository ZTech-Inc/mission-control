import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrgData, buildDocTree } from '@/lib/ztech-scanner'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const teamId = Number(id)
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const { teams, departments } = getOrgData()
  const team = teams.find(t => t.id === teamId)
  if (!team || !team.dir_name) return NextResponse.json({ docs: [] })

  const dept = departments.find(d => d.id === team.department_id)
  if (!dept || !dept.dir_name) return NextResponse.json({ docs: [] })

  const deptDirName = dept.dir_name
  const teamDirName = team.dir_name
  if (deptDirName.includes('/') || deptDirName.includes('..') || deptDirName.startsWith('.')) {
    return NextResponse.json({ docs: [] })
  }
  if (teamDirName.includes('/') || teamDirName.includes('..') || teamDirName.startsWith('.')) {
    return NextResponse.json({ docs: [] })
  }

  const docs = buildDocTree(deptDirName, teamDirName)
  return NextResponse.json({ docs })
}

export async function POST(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
