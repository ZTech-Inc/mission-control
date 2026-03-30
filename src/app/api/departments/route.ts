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

const createDepartmentSchema = z.object({
  name: z.string().min(1).max(100),
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
    departments: snapshot.departments,
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

  const parsed = createDepartmentSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const body = parsed.data
  const deptPath = path.join(config.agentsDir, body.name)
  mkdirSync(deptPath, { recursive: true })

  const externalId = stableNumber(`dept:${deptPath}`)
  const db = getDatabase()
  const result = db.prepare(
    `INSERT INTO departments (workspace_id, external_id, name, source, source_path)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, external_id) DO UPDATE SET
       name = excluded.name,
       source = excluded.source,
       source_path = excluded.source_path,
       updated_at = unixepoch()`
  ).run(workspaceId, externalId, body.name, 'manual', deptPath)

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json(
    { ok: true, department: { id: Number(result.lastInsertRowid) || externalId, name: body.name } },
    { status: 201 }
  )
}
