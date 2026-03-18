import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { MOCK_DEPARTMENTS } from '@/lib/mock-org-data'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ departments: MOCK_DEPARTMENTS })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
