import { NextRequest, NextResponse } from 'next/server'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { getOrgSnapshot, invalidateOrgSnapshot } from '@/lib/org-scanner'
import { orgWatcher } from '@/lib/org-watcher'

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  department_name: z.string().min(1),
})

function stableNumber(key: string): number {
  const hex = createHash('sha1').update(key).digest('hex').slice(0, 12)
  const parsed = Number.parseInt(hex, 16)
  return Math.max(1, parsed % 2_147_483_647)
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  orgWatcher.ensureStarted(auth.user.workspace_id ?? 1)
  const snapshot = getOrgSnapshot({ workspaceId: auth.user.workspace_id ?? 1 })
  return NextResponse.json({
    teams: snapshot.teams,
    source: snapshot.source,
    scannedAt: snapshot.scannedAt,
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!config.agentsDir) {
    return NextResponse.json({ error: 'Agents directory not configured' }, { status: 400 })
  }

  const parsed = createTeamSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const body = parsed.data
  const teamPath = path.join(config.agentsDir, body.department_name, body.name)
  mkdirSync(teamPath, { recursive: true })

  const externalId = stableNumber(`team:${teamPath}`)
  const db = getDatabase()
  const department = db.prepare(
    'SELECT external_id FROM departments WHERE workspace_id = ? AND name = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(workspaceId, body.department_name) as { external_id: number } | undefined

  if (!department) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  const result = db.prepare(
    `INSERT INTO teams (workspace_id, external_id, department_external_id, name, description, source, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, external_id) DO UPDATE SET
       department_external_id = excluded.department_external_id,
       name = excluded.name,
       description = excluded.description,
       source = excluded.source,
       source_path = excluded.source_path,
       updated_at = unixepoch()`
  ).run(
    workspaceId,
    externalId,
    department.external_id,
    body.name,
    body.description ?? '',
    'manual',
    teamPath
  )

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json(
    { ok: true, team: { id: Number(result.lastInsertRowid) || externalId, name: body.name } },
    { status: 201 }
  )
}
