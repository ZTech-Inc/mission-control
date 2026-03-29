import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { MOCK_AGENT_ASSIGNMENTS, MOCK_DEPARTMENTS, MOCK_TEAMS } from '@/lib/mock-org-data'
import type { AgentTeamAssignment, Department, Team } from '@/store'

const COLOR_PALETTE = [
  '#89b4fa',
  '#74c7ec',
  '#a6e3a1',
  '#f9e2af',
  '#f5c2e7',
  '#cba6f7',
  '#fab387',
  '#94e2d5',
]

const ORG_SOURCE_MOCK = 'mock'
const ORG_SOURCE_FILESYSTEM = 'filesystem'

export interface OrgSnapshot {
  departments: Department[]
  teams: Team[]
  agentAssignments: AgentTeamAssignment[]
  source: typeof ORG_SOURCE_MOCK | typeof ORG_SOURCE_FILESYSTEM
  rootPath: string | null
  scannedAt: number
}

interface ParsedAgentMetadata {
  name?: string
  role?: string
  skills: string[]
  kpis: string[]
  department?: string
  team?: string
  assignmentRole?: 'member' | 'lead'
}

interface DbAgentRow {
  id: number
  name: string
  role: string
  soul_content: string | null
  source: string | null
  content_hash: string | null
  workspace_path: string | null
  config: string | null
}

interface CacheState {
  snapshots: Map<number, OrgSnapshot>
}

const globalCache = globalThis as typeof globalThis & { __orgSnapshotCache?: CacheState }
const cache = globalCache.__orgSnapshotCache ?? { snapshots: new Map<number, OrgSnapshot>() }
globalCache.__orgSnapshotCache = cache

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function fallbackSnapshot(): OrgSnapshot {
  return {
    departments: MOCK_DEPARTMENTS,
    teams: MOCK_TEAMS,
    agentAssignments: MOCK_AGENT_ASSIGNMENTS,
    source: ORG_SOURCE_MOCK,
    rootPath: null,
    scannedAt: nowInSeconds(),
  }
}

function stableNumber(key: string): number {
  const hex = createHash('sha1').update(key).digest('hex').slice(0, 12)
  const parsed = Number.parseInt(hex, 16)
  return Math.max(1, parsed % 2_147_483_647)
}

function colorForKey(key: string): string {
  return COLOR_PALETTE[stableNumber(`color:${key}`) % COLOR_PALETTE.length] ?? COLOR_PALETTE[0]
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.github',
  '.vscode',
  '.idea',
  'node_modules',
  '__pycache__',
  '.DS_Store',
])

function safeDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED_DIRECTORIES.has(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function safeRead(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function firstHeading(content: string): string | undefined {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('#')) continue
    const heading = line.replace(/^#+\s*/, '').trim()
    if (heading) return heading
  }
  return undefined
}

function parseField(content: string, keys: string[]): string | undefined {
  const pattern = new RegExp(
    `^(?:${keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*:\\s*(.+)$`,
    'i'
  )

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    const match = line.match(pattern)
    if (match?.[1]) return match[1].trim()
  }

  return undefined
}

function parseInlineList(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseListField(content: string, keys: string[]): string[] {
  const lines = content.split('\n')
  const keyPattern = new RegExp(
    `^(?:${keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*:\\s*(.*)$`,
    'i'
  )

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? ''
    const line = rawLine.trim()
    const match = line.match(keyPattern)
    if (!match) continue

    const items: string[] = []
    if (match[1]) {
      items.push(...parseInlineList(match[1]))
    }

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex] ?? ''
      const trimmed = nextLine.trim()

      if (!trimmed) break
      if (/^[A-Za-z][A-Za-z0-9 _/-]*\s*:/.test(trimmed)) break

      const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
      if (!bulletMatch?.[1]) break
      items.push(bulletMatch[1].trim())
    }

    return [...new Set(items.filter(Boolean))]
  }

  return []
}

function parseAgentMetadata(agentName: string, agentMd: string, identityMd: string): ParsedAgentMetadata {
  const name =
    parseField(agentMd, ['name']) ||
    parseField(identityMd, ['name']) ||
    firstHeading(agentMd) ||
    firstHeading(identityMd)

  const role =
    parseField(agentMd, ['role', 'title']) ||
    parseField(identityMd, ['role', 'theme', 'title'])

  const assignmentValue = (
    parseField(agentMd, ['assignment_role', 'team_role', 'org_role']) ||
    parseField(identityMd, ['assignment_role', 'team_role', 'org_role']) ||
    ''
  ).toLowerCase()

  return {
    name: name || agentName,
    role,
    skills: [
      ...parseListField(agentMd, ['skills', 'capabilities']),
      ...parseListField(identityMd, ['skills', 'capabilities']),
    ],
    kpis: [
      ...parseListField(agentMd, ['kpis', 'goals', 'metrics']),
      ...parseListField(identityMd, ['kpis', 'goals', 'metrics']),
    ],
    department: parseField(agentMd, ['department']) || parseField(identityMd, ['department']),
    team: parseField(agentMd, ['team']) || parseField(identityMd, ['team']),
    assignmentRole: assignmentValue === 'lead' ? 'lead' : 'member',
  }
}

function buildAgentContentHash(parts: string[]): string {
  return createHash('sha1').update(parts.join('\n---\n'), 'utf8').digest('hex')
}

function mergeConfig(existingConfig: string | null, nextConfig: Record<string, unknown>): string {
  try {
    const parsed = existingConfig ? JSON.parse(existingConfig) : {}
    return JSON.stringify({ ...parsed, ...nextConfig })
  } catch {
    return JSON.stringify(nextConfig)
  }
}

function ensureFilesystemAgent(params: {
  workspaceId: number
  name: string
  role: string
  soulContent: string | null
  contentHash: string
  workspacePath: string
  config: Record<string, unknown>
}): number {
  const db = getDatabase()
  const now = nowInSeconds()

  const findByPath = db.prepare(
    `SELECT id, name, role, soul_content, source, content_hash, workspace_path, config
     FROM agents
     WHERE workspace_id = ? AND workspace_path = ?`
  )

  const findByName = db.prepare(
    `SELECT id, name, role, soul_content, source, content_hash, workspace_path, config
     FROM agents
     WHERE workspace_id = ? AND name = ?`
  )

  const existing =
    (findByPath.get(params.workspaceId, params.workspacePath) as DbAgentRow | undefined) ??
    (findByName.get(params.workspaceId, params.name) as DbAgentRow | undefined)

  if (existing) {
    db.prepare(
      `UPDATE agents
       SET name = ?,
           role = ?,
           soul_content = ?,
           source = 'filesystem',
           content_hash = ?,
           workspace_path = ?,
           config = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      params.name,
      params.role || existing.role || 'agent',
      params.soulContent ?? existing.soul_content,
      params.contentHash,
      params.workspacePath,
      mergeConfig(existing.config, params.config),
      now,
      existing.id
    )

    return existing.id
  }

  const result = db.prepare(
    `INSERT INTO agents (
      name, role, soul_content, status, created_at, updated_at, config, workspace_id, source, content_hash, workspace_path
    ) VALUES (?, ?, ?, 'offline', ?, ?, ?, ?, 'filesystem', ?, ?)`
  ).run(
    params.name,
    params.role || 'agent',
    params.soulContent,
    now,
    now,
    JSON.stringify(params.config),
    params.workspaceId,
    params.contentHash,
    params.workspacePath
  )

  return Number(result.lastInsertRowid)
}

function applyFilesystemOrgPersistence(
  workspaceId: number,
  rootPath: string,
  departments: Department[],
  teams: Team[],
  agentAssignments: AgentTeamAssignment[]
): void {
  const db = getDatabase()

  const upsertDepartment = db.prepare(`
    INSERT INTO departments (
      workspace_id, external_id, name, description, color, source, source_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'filesystem', ?, ?, ?)
    ON CONFLICT(workspace_id, external_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      source = excluded.source,
      source_path = excluded.source_path,
      updated_at = excluded.updated_at
  `)

  const upsertTeam = db.prepare(`
    INSERT INTO teams (
      workspace_id, external_id, department_external_id, name, description, color, source, source_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'filesystem', ?, ?, ?)
    ON CONFLICT(workspace_id, external_id) DO UPDATE SET
      department_external_id = excluded.department_external_id,
      name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      source = excluded.source,
      source_path = excluded.source_path,
      updated_at = excluded.updated_at
  `)

  const upsertAssignment = db.prepare(`
    INSERT INTO agent_team_assignments (
      workspace_id, agent_id, team_external_id, role, assigned_at, source
    ) VALUES (?, ?, ?, ?, ?, 'filesystem')
    ON CONFLICT(workspace_id, agent_id, team_external_id) DO UPDATE SET
      role = excluded.role,
      assigned_at = excluded.assigned_at,
      source = excluded.source
  `)

  const deleteDepartmentsNotIn = (externalIds: number[]) => {
    if (externalIds.length === 0) {
      db.prepare(`DELETE FROM departments WHERE workspace_id = ? AND source = 'filesystem'`).run(workspaceId)
      return
    }

    const placeholders = externalIds.map(() => '?').join(', ')
    db.prepare(
      `DELETE FROM departments
       WHERE workspace_id = ? AND source = 'filesystem' AND external_id NOT IN (${placeholders})`
    ).run(workspaceId, ...externalIds)
  }

  const deleteTeamsNotIn = (externalIds: number[]) => {
    if (externalIds.length === 0) {
      db.prepare(`DELETE FROM teams WHERE workspace_id = ? AND source = 'filesystem'`).run(workspaceId)
      return
    }

    const placeholders = externalIds.map(() => '?').join(', ')
    db.prepare(
      `DELETE FROM teams
       WHERE workspace_id = ? AND source = 'filesystem' AND external_id NOT IN (${placeholders})`
    ).run(workspaceId, ...externalIds)
  }

  const deleteAssignmentsNotIn = (keys: string[]) => {
    if (keys.length === 0) {
      db.prepare(`DELETE FROM agent_team_assignments WHERE workspace_id = ? AND source = 'filesystem'`).run(workspaceId)
      return
    }

    const placeholders = keys.map(() => '?').join(', ')
    db.prepare(
      `DELETE FROM agent_team_assignments
       WHERE workspace_id = ? AND source = 'filesystem'
         AND printf('%d:%d', agent_id, team_external_id) NOT IN (${placeholders})`
    ).run(workspaceId, ...keys)
  }

  db.transaction(() => {
    for (const department of departments) {
      upsertDepartment.run(
        workspaceId,
        department.id,
        department.name,
        department.description ?? null,
        department.color ?? null,
        path.join(rootPath, department.name),
        department.created_at,
        department.updated_at
      )
    }

    for (const team of teams) {
      const department = departments.find((entry) => entry.id === team.department_id)
      const teamPath = department ? path.join(rootPath, department.name, team.name) : null
      upsertTeam.run(
        workspaceId,
        team.id,
        team.department_id,
        team.name,
        team.description ?? null,
        team.color ?? null,
        teamPath,
        team.created_at,
        team.updated_at
      )
    }

    for (const assignment of agentAssignments) {
      upsertAssignment.run(
        workspaceId,
        assignment.agent_id,
        assignment.team_id,
        assignment.role,
        assignment.assigned_at
      )
    }

    deleteAssignmentsNotIn(agentAssignments.map((assignment) => `${assignment.agent_id}:${assignment.team_id}`))
    deleteTeamsNotIn(teams.map((team) => team.id))
    deleteDepartmentsNotIn(departments.map((department) => department.id))
  })()
}

function scanFilesystemOrg(rootPath: string, workspaceId: number): OrgSnapshot {
  const resolvedRoot = path.resolve(rootPath)
  const startedAt = nowInSeconds()
  const departments: Department[] = []
  const teams: Team[] = []
  const agentAssignments: AgentTeamAssignment[] = []
  const db = getDatabase()

  const syncTxn = db.transaction(() => {
    for (const departmentName of safeDirectories(resolvedRoot)) {
      const departmentPath = path.join(resolvedRoot, departmentName)
      const departmentId = stableNumber(`dept:${departmentPath}`)
      const departmentColor = colorForKey(`dept:${departmentName}`)

      departments.push({
        id: departmentId,
        name: departmentName,
        description: `Synced from ${path.relative(resolvedRoot, departmentPath) || departmentName}`,
        color: departmentColor,
        created_at: startedAt,
        updated_at: startedAt,
      })

      for (const teamName of safeDirectories(departmentPath)) {
        const teamPath = path.join(departmentPath, teamName)
        const teamId = stableNumber(`team:${teamPath}`)
        const teamColor = colorForKey(`team:${teamName}`)

        teams.push({
          id: teamId,
          name: teamName,
          description: `Synced from ${path.relative(resolvedRoot, teamPath) || teamName}`,
          department_id: departmentId,
          color: teamColor,
          created_at: startedAt,
          updated_at: startedAt,
        })

        for (const agentDirName of safeDirectories(teamPath)) {
          const agentPath = path.join(teamPath, agentDirName)
          const agentMd = safeRead(path.join(agentPath, 'AGENT.md'))
          const identityMd = safeRead(path.join(agentPath, 'IDENTITY.md'))
          const soulMd = safeRead(path.join(agentPath, 'SOUL.md'))
          const userMd = safeRead(path.join(agentPath, 'USER.md'))
          const metadata = parseAgentMetadata(agentDirName, agentMd, identityMd)
          const agentName = metadata.name || agentDirName
          const agentRole = metadata.role || 'agent'
          const contentHash = buildAgentContentHash([agentMd, identityMd, soulMd, userMd, agentPath])
          const agentId = ensureFilesystemAgent({
            workspaceId,
            name: agentName,
            role: agentRole,
            soulContent: soulMd || agentMd || identityMd || null,
            contentHash,
            workspacePath: agentPath,
            config: {
              orgSource: 'filesystem',
              folderOrg: {
                department: metadata.department || departmentName,
                team: metadata.team || teamName,
                path: agentPath,
              },
              skills: metadata.skills,
              kpis: metadata.kpis,
            },
          })

          agentAssignments.push({
            agent_id: agentId,
            team_id: teamId,
            role: metadata.assignmentRole || 'member',
            assigned_at: startedAt,
          })
        }
      }
    }
  })

  syncTxn()
  applyFilesystemOrgPersistence(workspaceId, resolvedRoot, departments, teams, agentAssignments)

  return {
    departments,
    teams,
    agentAssignments,
    source: ORG_SOURCE_FILESYSTEM,
    rootPath: resolvedRoot,
    scannedAt: startedAt,
  }
}

export function invalidateOrgSnapshot(workspaceId?: number): void {
  if (typeof workspaceId === 'number') {
    cache.snapshots.delete(workspaceId)
    return
  }

  cache.snapshots.clear()
}

export function getOrgSnapshot(options?: { force?: boolean; workspaceId?: number }): OrgSnapshot {
  const force = options?.force === true
  const workspaceId = options?.workspaceId ?? 1

  if (!force) {
    const cached = cache.snapshots.get(workspaceId)
    if (cached) return cached
  }

  const agentsDir = config.agentsDir?.trim()
  if (!agentsDir) {
    const snapshot = fallbackSnapshot()
    cache.snapshots.set(workspaceId, snapshot)
    return snapshot
  }

  if (!existsSync(agentsDir)) {
    logger.warn({ agentsDir }, 'AGENTS_DIR does not exist, using mock org data')
    const snapshot = fallbackSnapshot()
    cache.snapshots.set(workspaceId, snapshot)
    return snapshot
  }

  try {
    const stat = statSync(agentsDir)
    if (!stat.isDirectory()) {
      logger.warn({ agentsDir }, 'AGENTS_DIR is not a directory, using mock org data')
      const snapshot = fallbackSnapshot()
      cache.snapshots.set(workspaceId, snapshot)
      return snapshot
    }

    const snapshot = scanFilesystemOrg(agentsDir, workspaceId)
    cache.snapshots.set(workspaceId, snapshot)
    return snapshot
  } catch (error) {
    logger.error({ err: error, agentsDir }, 'Failed to scan AGENTS_DIR, using mock org data')
    const snapshot = fallbackSnapshot()
    cache.snapshots.set(workspaceId, snapshot)
    return snapshot
  }
}
