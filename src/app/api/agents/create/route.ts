import { NextRequest, NextResponse } from 'next/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'

const createAgentBodySchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().optional().default(''),
  model: z.string().optional().default(''),
  identity_md: z.string().optional().default(''),
  agent_md: z.string().optional().default(''),
  soul_md: z.string().optional().default(''),
  department_name: z.string().min(1),
  team_name: z.string().optional(),
  is_manager: z.boolean().optional().default(false),
  tool_allow: z.array(z.string()).optional().default([]),
  tool_deny: z.array(z.string()).optional().default([]),
  tool_profile: z.string().optional().default(''),
  model_primary: z.string().optional().default(''),
  model_fallback: z.array(z.string()).optional().default([]),
})

function stableNumber(key: string): number {
  const hex = createHash('sha1').update(key).digest('hex').slice(0, 12)
  const parsed = Number.parseInt(hex, 16)
  return Math.max(1, parsed % 2_147_483_647)
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!config.agentsDir) {
    return NextResponse.json({ error: 'Agents directory not configured' }, { status: 400 })
  }

  const parsed = createAgentBodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const body = parsed.data

  if (!body.is_manager && !body.team_name) {
    return NextResponse.json({ error: 'team_name is required for non-manager agents' }, { status: 400 })
  }

  const teamName = body.team_name ?? ''
  const db = getDatabase()
  const department = db.prepare(
    'SELECT external_id FROM departments WHERE workspace_id = ? AND name = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(workspaceId, body.department_name) as { external_id: number } | undefined

  if (!department) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  let teamExternalId: number | null = null
  if (!body.is_manager && teamName) {
    const team = db.prepare(
      `SELECT external_id
       FROM teams
       WHERE workspace_id = ? AND name = ? AND department_external_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    ).get(workspaceId, teamName, department.external_id) as { external_id: number } | undefined
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    teamExternalId = team.external_id
  }

  const agentDir = body.is_manager
    ? path.join(config.agentsDir, body.department_name, 'MANAGER')
    : path.join(config.agentsDir, body.department_name, teamName, body.name)

  mkdirSync(agentDir, { recursive: true })

  const identityMd =
    body.identity_md ||
    `# ${body.name}\n\n${body.role ? `Role: ${body.role}` : ''}`.trimEnd()
  const agentMd = body.agent_md || `# Agent Configuration\n\nName: ${body.name}`
  const soulMd = body.soul_md || `# Soul\n\nPurpose: ${body.role || 'General agent'}`

  writeFileSync(path.join(agentDir, 'IDENTITY.md'), identityMd, 'utf-8')
  writeFileSync(path.join(agentDir, 'AGENT.md'), agentMd, 'utf-8')
  writeFileSync(path.join(agentDir, 'SOUL.md'), soulMd, 'utf-8')

  const externalId = stableNumber(`agent:${agentDir}`)
  const now = Math.floor(Date.now() / 1000)
  const configPayload = {
    external_id: externalId,
    model: {
      primary: body.model_primary || body.model || '',
      fallbacks: body.model_fallback ?? [],
    },
    tools: {
      allow: body.tool_allow ?? [],
      deny: body.tool_deny ?? [],
      profile: body.tool_profile || '',
    },
  }

  const agentInsert = db.prepare(
    `INSERT INTO agents (name, role, soul_content, status, created_at, updated_at, config, workspace_id, source, workspace_path)
     VALUES (?, ?, ?, 'offline', ?, ?, ?, ?, 'manual', ?)`
  ).run(
    body.name,
    body.role || 'agent',
    soulMd,
    now,
    now,
    JSON.stringify(configPayload),
    workspaceId,
    agentDir
  )
  const agentId = Number(agentInsert.lastInsertRowid)

  if (!body.is_manager && teamExternalId !== null) {
    db.prepare(
      `INSERT INTO agent_team_assignments (workspace_id, agent_id, team_external_id, role, assigned_at, source)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, agent_id, team_external_id) DO UPDATE SET
         role = excluded.role,
         assigned_at = excluded.assigned_at,
         source = excluded.source`
    ).run(workspaceId, agentId, teamExternalId, 'member', now, 'manual')
  }

  if (body.is_manager) {
    const result = db.prepare(
      'UPDATE departments SET manager_agent_id = ?, updated_at = unixepoch() WHERE workspace_id = ? AND name = ?'
    ).run(agentId, workspaceId, body.department_name)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 })
    }
  }

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json(
    {
      ok: true,
      agent: {
        id: agentId,
        name: body.name,
        role: body.role || 'agent',
      },
    },
    { status: 201 }
  )
}
