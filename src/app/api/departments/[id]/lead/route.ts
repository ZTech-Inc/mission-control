import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { writeDepartmentMetadata } from '@/lib/org-metadata'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { validateBody } from '@/lib/validation'

const putManagerSchema = z.object({
  agent_id: z.number().int().positive().nullable(),
})

export const runtime = 'nodejs'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const deptExternalId = Number.parseInt(id, 10)
  if (Number.isNaN(deptExternalId)) {
    return NextResponse.json({ error: 'Invalid department id' }, { status: 400 })
  }

  const validated = await validateBody(request, putManagerSchema)
  if ('error' in validated) return validated.error

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const departmentRow = db.prepare(
    `SELECT source_path
     FROM departments
     WHERE workspace_id = ? AND external_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(workspaceId, deptExternalId) as { source_path: string | null } | undefined

  if (!departmentRow?.source_path) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  if (validated.data.agent_id != null) {
    const agentRow = db.prepare(
      `SELECT workspace_path
       FROM agents
       WHERE id = ? AND workspace_id = ?
       LIMIT 1`
    ).get(validated.data.agent_id, workspaceId) as { workspace_path: string | null } | undefined

    if (!agentRow?.workspace_path) {
      return NextResponse.json({ error: 'Agent path not found' }, { status: 404 })
    }
    const managerAgentDir = path.relative(departmentRow.source_path, agentRow.workspace_path)
    if (path.isAbsolute(managerAgentDir) || managerAgentDir.startsWith('..')) {
      return NextResponse.json(
        { error: 'Department manager must live inside the department directory to persist in filesystem metadata' },
        { status: 422 }
      )
    }

    writeDepartmentMetadata(departmentRow.source_path, {
      manager_agent_dir: managerAgentDir,
    })
  } else {
    writeDepartmentMetadata(departmentRow.source_path, {})
  }

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
