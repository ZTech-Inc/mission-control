import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getDatabase } from '@/lib/db'

type SkillRow = {
  name: string
  source: string
  path: string
  description: string | null
  content_hash: string | null
}

type DiskSkill = {
  name: string
  path: string
  description: string | undefined
  contentHash: string
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function extractDescription(content: string): string | undefined {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const first = lines.find((line) => !line.startsWith('#'))
  if (!first) return undefined
  return first.length > 220 ? `${first.slice(0, 217)}...` : first
}

function slugifyAgentName(agentName: string): string {
  return agentName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function scanOrgAgentSkills(workspacePath: string): DiskSkill[] {
  const skillsRoot = join(workspacePath, 'skills')
  if (!existsSync(skillsRoot)) return []

  let entries: string[]
  try {
    entries = readdirSync(skillsRoot)
  } catch {
    return []
  }

  const skills: DiskSkill[] = []
  for (const entry of entries) {
    const skillPath = join(skillsRoot, entry)
    try {
      if (!statSync(skillPath).isDirectory()) continue
    } catch {
      continue
    }

    const skillDocPath = join(skillPath, 'SKILL.md')
    if (!existsSync(skillDocPath)) continue

    try {
      const content = readFileSync(skillDocPath, 'utf8')
      skills.push({
        name: entry,
        path: skillPath,
        description: extractDescription(content),
        contentHash: sha256(content),
      })
    } catch {
      // Skip unreadable files.
    }
  }

  return skills
}

export function buildOrgAgentSkillSource(agentName: string): string {
  const slug = slugifyAgentName(agentName) || 'unknown-agent'
  return `org-agent:${slug}`
}

export async function syncOrgAgentSkills(params: {
  agentId: number
  agentName: string
  workspacePath: string | null
}): Promise<{ source: string; created: number; updated: number; deleted: number; total: number }> {
  const source = buildOrgAgentSkillSource(params.agentName)
  const workspacePath = params.workspacePath?.trim()

  if (!workspacePath || !existsSync(workspacePath)) {
    return { source, created: 0, updated: 0, deleted: 0, total: 0 }
  }

  try {
    if (!statSync(workspacePath).isDirectory()) {
      return { source, created: 0, updated: 0, deleted: 0, total: 0 }
    }
  } catch {
    return { source, created: 0, updated: 0, deleted: 0, total: 0 }
  }

  const db = getDatabase()
  const diskSkills = scanOrgAgentSkills(workspacePath)
  const now = new Date().toISOString()

  const diskMap = new Map(diskSkills.map((skill) => [skill.name, skill]))
  const existingRows = db.prepare(
    'SELECT name, source, path, description, content_hash FROM skills WHERE source = ?',
  ).all(source) as SkillRow[]
  const existingMap = new Map(existingRows.map((row) => [row.name, row]))

  const insertStmt = db.prepare(`
    INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateStmt = db.prepare(`
    UPDATE skills
    SET path = ?, description = ?, content_hash = ?, updated_at = ?
    WHERE source = ? AND name = ?
  `)
  const deleteStmt = db.prepare('DELETE FROM skills WHERE source = ? AND name = ?')

  let created = 0
  let updated = 0
  let deleted = 0

  db.transaction(() => {
    for (const skill of diskSkills) {
      const existing = existingMap.get(skill.name)
      if (!existing) {
        insertStmt.run(skill.name, source, skill.path, skill.description || null, skill.contentHash, now, now)
        created += 1
        continue
      }

      if (
        existing.path !== skill.path ||
        existing.description !== (skill.description || null) ||
        existing.content_hash !== skill.contentHash
      ) {
        updateStmt.run(skill.path, skill.description || null, skill.contentHash, now, source, skill.name)
        updated += 1
      }
    }

    for (const row of existingRows) {
      if (diskMap.has(row.name)) continue
      deleteStmt.run(source, row.name)
      deleted += 1
    }
  })()

  return {
    source,
    created,
    updated,
    deleted,
    total: diskSkills.length,
  }
}
