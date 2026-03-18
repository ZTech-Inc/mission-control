import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { MOCK_TEAMS } from '@/lib/mock-org-data'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ teams: MOCK_TEAMS })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
