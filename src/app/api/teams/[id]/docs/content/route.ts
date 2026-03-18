import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { MOCK_DOC_CONTENT } from '@/lib/mock-org-data'

export async function GET(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const fileName = searchParams.get('path')?.split('/').pop() ?? ''
  const content = MOCK_DOC_CONTENT[fileName] ?? '# Not found\n'

  return NextResponse.json({
    content,
    links: { wikiLinks: [], incoming: [], outgoing: [] },
  })
}

export async function PUT(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
