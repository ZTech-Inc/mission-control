import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readDocContent } from '@/lib/ztech-scanner'

export async function GET(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const filePath = searchParams.get('path') ?? ''
  const content = filePath ? readDocContent(filePath) : '# Not found\n'

  return NextResponse.json({
    content: content || '# Not found\n',
    links: { wikiLinks: [], incoming: [], outgoing: [] },
  })
}

export async function PUT(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ ok: true })
}
