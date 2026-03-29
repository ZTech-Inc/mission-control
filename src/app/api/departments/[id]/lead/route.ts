import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { validateBody } from '@/lib/validation'

const putLeadSchema = z.object({
  agent_id: z.number().int().positive().nullable(),
})

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const deptExternalId = Number.parseInt(id, 10)
  if (Number.isNaN(deptExternalId)) {
    return NextResponse.json({ error: 'Invalid department id' }, { status: 400 })
  }

  const validated = await validateBody(request, putLeadSchema)
  if ('error' in validated) return validated.error

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const result = db.prepare(
    `UPDATE departments
     SET manager_agent_id = ?, updated_at = unixepoch()
     WHERE workspace_id = ? AND external_id = ?`
  ).run(validated.data.agent_id, workspaceId, deptExternalId)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json({ ok: true })
}
