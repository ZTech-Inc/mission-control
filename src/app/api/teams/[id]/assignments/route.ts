import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { validateBody } from '@/lib/validation'

const patchSchema = z.object({
  agent_id: z.number().int().positive(),
  role: z.enum(['member', 'lead']),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const teamExternalId = Number.parseInt(id, 10)
  if (Number.isNaN(teamExternalId)) {
    return NextResponse.json({ error: 'Invalid team id' }, { status: 400 })
  }

  const validated = await validateBody(request, patchSchema)
  if ('error' in validated) return validated.error

  const { agent_id, role } = validated.data
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const existing = db.prepare(
    `SELECT id
     FROM agent_team_assignments
     WHERE workspace_id = ? AND agent_id = ? AND team_external_id = ?`
  ).get(workspaceId, agent_id, teamExternalId) as { id: number } | undefined

  if (!existing) {
    return NextResponse.json({ error: 'Agent is not a member of this team' }, { status: 422 })
  }

  const updateAssignment = db.prepare(
    `UPDATE agent_team_assignments
     SET role = ?, source = 'manual'
     WHERE workspace_id = ? AND agent_id = ? AND team_external_id = ?`
  )

  const demoteLead = db.prepare(
    `UPDATE agent_team_assignments
     SET role = 'member', source = 'manual'
     WHERE workspace_id = ? AND team_external_id = ? AND role = 'lead' AND agent_id != ?`
  )

  db.transaction(() => {
    if (role === 'lead') {
      demoteLead.run(workspaceId, teamExternalId, agent_id)
    }

    updateAssignment.run(role, workspaceId, agent_id, teamExternalId)
  })()

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json({ ok: true })
}
