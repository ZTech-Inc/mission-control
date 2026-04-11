import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { resolveWithin } from '@/lib/paths'
import { checkSkillSecurity } from '@/lib/skill-registry'

interface SkillSummary {
  id: string
  name: string
  source: string
  path: string
  description?: string
  registry_slug?: string | null
  security_status?: string | null
}

type SkillRoot = { source: string; path: string }

function resolveSkillRoot(
  envName: string,
  fallback: string,
): string {
  const override = process.env[envName]
  return override && override.trim().length > 0 ? override.trim() : fallback
}

function resolveProjectAgentsSkillsDir(cwd: string): string {
  const explicit = process.env.MC_SKILLS_PROJECT_AGENTS_DIR
  if (explicit && explicit.trim().length > 0) return explicit.trim()

  const configuredAgentsDir = process.env.MISSION_CONTROL_AGENTS_DIR
  if (configuredAgentsDir && configuredAgentsDir.trim().length > 0) {
    const skillsLibraryDir = join(configuredAgentsDir.trim(), '.skills_library')
    if (existsSync(skillsLibraryDir)) return skillsLibraryDir
  }

  return join(cwd, '.agents', 'skills')
}

async function pathReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function extractDescription(skillPath: string): Promise<string | undefined> {
  const skillDocPath = join(skillPath, 'SKILL.md')
  if (!(await pathReadable(skillDocPath))) return undefined
  try {
    const content = await readFile(skillDocPath, 'utf8')
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
    const firstParagraph = lines.find((line) => !line.startsWith('#'))
    if (!firstParagraph) return undefined
    return firstParagraph.length > 220 ? `${firstParagraph.slice(0, 217)}...` : firstParagraph
  } catch {
    return undefined
  }
}

async function collectSkillsFromDir(baseDir: string, source: string): Promise<SkillSummary[]> {
  if (!(await pathReadable(baseDir))) return []
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    const out: SkillSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(baseDir, entry.name)
      const skillDocPath = join(skillPath, 'SKILL.md')
      if (!(await pathReadable(skillDocPath))) continue
      out.push({
        id: `${source}:${entry.name}`,
        name: entry.name,
        source,
        path: skillPath,
        description: await extractDescription(skillPath),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function getSkillRoots(): SkillRoot[] {
  const home = homedir()
  const cwd = process.cwd()
  const roots: SkillRoot[] = [
    { source: 'user-agents', path: resolveSkillRoot('MC_SKILLS_USER_AGENTS_DIR', join(home, '.agents', 'skills')) },
    { source: 'user-codex', path: resolveSkillRoot('MC_SKILLS_USER_CODEX_DIR', join(home, '.codex', 'skills')) },
    { source: 'project-agents', path: resolveProjectAgentsSkillsDir(cwd) },
    { source: 'project-codex', path: resolveSkillRoot('MC_SKILLS_PROJECT_CODEX_DIR', join(cwd, '.codex', 'skills')) },
  ]
  // Add OpenClaw gateway skill roots when configured
  const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || join(home, '.openclaw')
  const openclawSkills = resolveSkillRoot('MC_SKILLS_OPENCLAW_DIR', join(openclawState, 'skills'))
  roots.push({ source: 'openclaw', path: openclawSkills })

  // Add OpenClaw workspace-local skills (takes precedence when names conflict)
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || process.env.MISSION_CONTROL_WORKSPACE_DIR || join(openclawState, 'workspace')
  const workspaceSkills = resolveSkillRoot('MC_SKILLS_WORKSPACE_DIR', join(workspaceDir, 'skills'))
  roots.push({ source: 'workspace', path: workspaceSkills })

  // Dynamic: scan for workspace-<agent> directories
  try {
    const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs')
    const entries = readdirSync(openclawState) as string[]
    for (const entry of entries) {
      if (!entry.startsWith('workspace-')) continue
      const skillsDir = join(openclawState, entry, 'skills')
      if (existsSync(skillsDir)) {
        const agentName = entry.replace('workspace-', '')
        roots.push({ source: `workspace-${agentName}`, path: skillsDir })
      }
    }
  } catch {
    // openclawBase may not exist
  }

  return roots
}

function normalizeSkillName(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) return null
  return value
}

function isOrgAgentSource(source: string): boolean {
  return source.startsWith('org-agent:')
}

function getRootBySource(roots: SkillRoot[], sourceRaw: string | null): SkillRoot | null {
  const source = String(sourceRaw || '').trim()
  if (!source) return null
  return roots.find((r) => r.source === source) || null
}

function getSkillRowFromDB(source: string, name: string): Pick<SkillSummary, 'source' | 'name' | 'path'> | null {
  try {
    const db = getDatabase()
    const row = db
      .prepare('SELECT source, name, path FROM skills WHERE source = ? AND name = ?')
      .get(source, name) as { source: string; name: string; path: string } | undefined
    return row ?? null
  } catch {
    return null
  }
}

function resolveSkillDocPath(
  roots: SkillRoot[],
  source: string,
  name: string,
): { skillPath: string; skillDocPath: string } | null {
  const root = roots.find((entry) => entry.source === source)
  if (root) {
    const skillPath = join(root.path, name)
    return { skillPath, skillDocPath: join(skillPath, 'SKILL.md') }
  }

  const row = getSkillRowFromDB(source, name)
  if (!row?.path) return null

  return {
    skillPath: row.path,
    skillDocPath: join(row.path, 'SKILL.md'),
  }
}

async function upsertSkill(root: SkillRoot, name: string, content: string) {
  const skillPath = resolveWithin(root.path, name)
  const skillDocPath = resolveWithin(skillPath, 'SKILL.md')
  await mkdir(skillPath, { recursive: true })
  await writeFile(skillDocPath, content, 'utf8')

  // Update DB hash so next sync cycle detects our write
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const hash = createHash('sha256').update(content, 'utf8').digest('hex')
    const now = new Date().toISOString()
    const descLines = content.split('\n').map(l => l.trim()).filter(Boolean)
    const desc = descLines.find(l => !l.startsWith('#'))
    db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, name) DO UPDATE SET
        path = excluded.path,
        description = excluded.description,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(
      name,
      root.source,
      skillPath,
      desc ? (desc.length > 220 ? `${desc.slice(0, 217)}...` : desc) : null,
      hash,
      now,
      now
    )
  } catch { /* DB not ready yet — sync will catch it */ }

  return { skillPath, skillDocPath }
}

async function deleteSkill(root: SkillRoot, name: string) {
  const skillPath = resolveWithin(root.path, name)
  await rm(skillPath, { recursive: true, force: true })

  // Remove from DB
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    db.prepare('DELETE FROM skills WHERE source = ? AND name = ?').run(root.source, name)
  } catch { /* best-effort */ }

  return { skillPath }
}

/**
 * Read persisted skill metadata from DB.
 * Live filesystem scan is still merged in GET so UI reflects disk changes immediately.
 */
function getSkillsFromDB(): SkillSummary[] {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT name, source, path, description, registry_slug, security_status FROM skills ORDER BY source, name').all() as Array<{
      name: string; source: string; path: string; description: string | null; registry_slug: string | null; security_status: string | null
    }>
    return rows.map(r => ({
      id: `${r.source}:${r.name}`,
      name: r.name,
      source: r.source,
      path: r.path,
      description: r.description || undefined,
      registry_slug: r.registry_slug,
      security_status: r.security_status,
    }))
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const roots = getSkillRoots()
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  if (mode === 'content') {
    const source = String(searchParams.get('source') || '')
    const name = normalizeSkillName(String(searchParams.get('name') || ''))
    if (!source || !name) {
      return NextResponse.json({ error: 'source and valid name are required' }, { status: 400 })
    }
    const resolved = resolveSkillDocPath(roots, source, name)
    if (!resolved) {
      return NextResponse.json(
        { error: isOrgAgentSource(source) ? 'SKILL.md not found' : 'Invalid source' },
        { status: isOrgAgentSource(source) ? 404 : 400 },
      )
    }
    const { skillPath, skillDocPath } = resolved
    if (!(await pathReadable(skillDocPath))) {
      return NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 })
    }
    const content = await readFile(skillDocPath, 'utf8')

    // Run security check inline
    const security = checkSkillSecurity(content)

    return NextResponse.json({
      source,
      name,
      skillPath,
      skillDocPath,
      content,
      security,
    })
  }

  if (mode === 'check') {
    // Security-check a specific skill's content
    const source = String(searchParams.get('source') || '')
    const name = normalizeSkillName(String(searchParams.get('name') || ''))
    if (!source || !name) {
      return NextResponse.json({ error: 'source and valid name are required' }, { status: 400 })
    }
    const resolved = resolveSkillDocPath(roots, source, name)
    if (!resolved) {
      return NextResponse.json(
        { error: isOrgAgentSource(source) ? 'SKILL.md not found' : 'Invalid source' },
        { status: isOrgAgentSource(source) ? 404 : 400 },
      )
    }
    const { skillDocPath } = resolved
    if (!(await pathReadable(skillDocPath))) {
      return NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 })
    }
    const content = await readFile(skillDocPath, 'utf8')
    const security = checkSkillSecurity(content)

    // Update DB with security status
    try {
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      db.prepare('UPDATE skills SET security_status = ?, updated_at = ? WHERE source = ? AND name = ?')
        .run(security.status, new Date().toISOString(), source, name)
    } catch { /* best-effort */ }

    return NextResponse.json({ source, name, security })
  }

  const bySource = await Promise.all(
    roots.map(async (root) => ({
      source: root.source,
      path: root.path,
      skills: await collectSkillsFromDir(root.path, root.source),
    }))
  )

  const dbSkills = getSkillsFromDB()
  const diskSkills = bySource.flatMap((group) => group.skills)

  const mergedBySourceAndName = new Map<string, SkillSummary>()
  for (const skill of dbSkills) mergedBySourceAndName.set(`${skill.source}:${skill.name}`, skill)
  for (const skill of diskSkills) mergedBySourceAndName.set(`${skill.source}:${skill.name}`, skill)
  const merged = Array.from(mergedBySourceAndName.values())

  const groupMap = new Map<string, { source: string; path: string; skills: SkillSummary[] }>()
  for (const root of roots) {
    groupMap.set(root.source, { source: root.source, path: root.path, skills: [] })
  }
  for (const skill of merged) {
    if (!groupMap.has(skill.source)) {
      groupMap.set(skill.source, { source: skill.source, path: dirname(skill.path), skills: [] })
    }
    const group = groupMap.get(skill.source)
    if (group) {
      if (!group.path) group.path = dirname(skill.path)
      group.skills.push(skill)
    }
  }
  for (const group of groupMap.values()) {
    group.skills.sort((a, b) => a.name.localeCompare(b.name))
  }

  const sourceOrder = new Map<string, number>()
  roots.forEach((root, index) => sourceOrder.set(root.source, index))
  const orderedSkills = merged
    .slice()
    .sort((a, b) => {
      const aOrder = sourceOrder.has(a.source) ? sourceOrder.get(a.source)! : Number.MAX_SAFE_INTEGER
      const bOrder = sourceOrder.has(b.source) ? sourceOrder.get(b.source)! : Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) return aOrder - bOrder
      const byName = a.name.localeCompare(b.name)
      if (byName !== 0) return byName
      return a.source.localeCompare(b.source)
    })

  const rootGroups = roots
    .map((root) => groupMap.get(root.source))
    .filter((group): group is { source: string; path: string; skills: SkillSummary[] } => Boolean(group))
  const dynamicGroups = Array.from(groupMap.values())
    .filter((group) => !sourceOrder.has(group.source))
    .sort((a, b) => a.source.localeCompare(b.source))

  return NextResponse.json({
    skills: orderedSkills,
    groups: [...rootGroups, ...dynamicGroups],
    total: orderedSkills.length,
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const roots = getSkillRoots()
  const body = await request.json().catch(() => ({}))
  const root = getRootBySource(roots, body?.source)
  const name = normalizeSkillName(String(body?.name || ''))
  const contentRaw = typeof body?.content === 'string' ? body.content : ''
  const content = contentRaw.trim() || `# ${name || 'skill'}\n\nDescribe this skill.\n`

  if (!root || !name) {
    return NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 })
  }

  await mkdir(root.path, { recursive: true })
  const { skillPath, skillDocPath } = await upsertSkill(root, name, content)
  return NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath })
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const roots = getSkillRoots()
  const body = await request.json().catch(() => ({}))
  const root = getRootBySource(roots, body?.source)
  const name = normalizeSkillName(String(body?.name || ''))
  const content = typeof body?.content === 'string' ? body.content : null

  if (!root || !name || content == null) {
    return NextResponse.json({ error: 'Valid source, name, and content are required' }, { status: 400 })
  }

  await mkdir(root.path, { recursive: true })
  const { skillPath, skillDocPath } = await upsertSkill(root, name, content)
  return NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath })
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const roots = getSkillRoots()
  const root = getRootBySource(roots, searchParams.get('source'))
  const name = normalizeSkillName(String(searchParams.get('name') || ''))
  if (!root || !name) {
    return NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 })
  }

  const { skillPath } = await deleteSkill(root, name)
  return NextResponse.json({ ok: true, source: root.source, name, skillPath })
}

export const dynamic = 'force-dynamic'
