import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { writeTeamMetadata } from '@/lib/org-metadata'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { validateBody } from '@/lib/validation'

export const runtime = 'nodejs'

const patchSchema = z.object({
  agent_id: z.number().int().positive(),
  role: z.enum(['member', 'lead']),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
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
    const teamRow = db.prepare(
      `SELECT source_path
       FROM teams
       WHERE workspace_id = ? AND external_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    ).get(workspaceId, teamExternalId) as { source_path: string | null } | undefined
    if (!teamRow?.source_path) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    const teamPath = teamRow.source_path

    const assignmentRow = db.prepare(
      `SELECT ata.role, a.workspace_path
       FROM agent_team_assignments ata
       LEFT JOIN agents a ON a.id = ata.agent_id
       WHERE ata.workspace_id = ? AND ata.team_external_id = ? AND ata.agent_id = ?
       LIMIT 1`
    ).get(workspaceId, teamExternalId, agent_id) as
      | { role: 'member' | 'lead'; workspace_path: string | null }
      | undefined
    if (!assignmentRow) {
      return NextResponse.json({ error: 'Agent is not a member of this team' }, { status: 422 })
    }
    if (!assignmentRow.workspace_path) {
      return NextResponse.json({ error: 'Agent path not found' }, { status: 404 })
    }
    const leadAgentDir = path.relative(teamPath, assignmentRow.workspace_path)
    if (role === 'lead' && (path.isAbsolute(leadAgentDir) || leadAgentDir.startsWith('..'))) {
      return NextResponse.json(
        { error: 'Lead agent must live inside the team directory to persist in filesystem metadata' },
        { status: 422 }
      )
    }

    const upsertAssignment = db.prepare(
      `INSERT INTO agent_team_assignments (workspace_id, agent_id, team_external_id, role, assigned_at, source)
       VALUES (?, ?, ?, ?, unixepoch(), 'manual')
       ON CONFLICT(workspace_id, agent_id, team_external_id) DO UPDATE SET
         role = excluded.role,
         assigned_at = excluded.assigned_at,
         source = excluded.source`
    )

    const demoteLead = db.prepare(
      `UPDATE agent_team_assignments
       SET role = 'member', source = 'manual'
       WHERE workspace_id = ? AND team_external_id = ? AND role = 'lead' AND agent_id != ?`
    )

    db.transaction(() => {
      if (role === 'lead') {
        demoteLead.run(workspaceId, teamExternalId, agent_id)
        writeTeamMetadata(teamPath, {
          lead_agent_dir: leadAgentDir,
        })
      } else if (assignmentRow.role === 'lead') {
        writeTeamMetadata(teamPath, {})
      }

      upsertAssignment.run(workspaceId, agent_id, teamExternalId, role)
    })()

    invalidateOrgSnapshot(workspaceId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update team assignment' }, { status: 500 })
  }
}
