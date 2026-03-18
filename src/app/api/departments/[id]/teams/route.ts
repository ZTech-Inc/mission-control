import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { MOCK_TEAMS } from '@/lib/mock-org-data'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  return NextResponse.json({ teams: MOCK_TEAMS.filter(t => t.department_id === Number(id)) })
}
