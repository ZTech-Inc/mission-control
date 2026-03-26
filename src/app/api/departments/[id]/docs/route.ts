import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrgData, buildDocTree } from '@/lib/ztech-scanner'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const deptId = Number(id)
  const { departments, orgAgents } = getOrgData()
  const dept = departments.find(d => d.id === deptId)
  if (!dept) return NextResponse.json({ docs: [] })

  // Derive the original directory name from an agent's dir_path (first path segment)
  const agentInDept = orgAgents.find(a => a.department_id === deptId)
  const deptDirName = agentInDept ? agentInDept.dir_path.split('/')[0] : null
  if (!deptDirName) return NextResponse.json({ docs: [] })

  const docs = buildDocTree(deptDirName)
  return NextResponse.json({ docs })
}

export async function POST(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
