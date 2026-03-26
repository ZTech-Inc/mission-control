import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getOrgData } from '@/lib/ztech-scanner'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const deptId = Number(id)
  if (!Number.isInteger(deptId) || deptId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  return NextResponse.json({ teams: getOrgData().teams.filter(t => t.department_id === deptId) })
}
