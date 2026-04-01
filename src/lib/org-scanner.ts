import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { readDepartmentMetadata, readTeamMetadata } from '@/lib/org-metadata'
import { MOCK_AGENT_ASSIGNMENTS, MOCK_DEPARTMENTS, MOCK_TEAMS } from '@/lib/mock-org-data'
import type { AgentTeamAssignment, Department, Team } from '@/store'
import { parseAgentProfile } from './agent-profile-parser'

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

export interface ParsedAgentMetadata {
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

const RESERVED_DEPARTMENT_SUBDIRS = new Set([
  'MANAGER',
  'docs',
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

export function parseMarkdownTableField(content: string, labels: string[]): string | undefined {
  const normalizedLabels = labels.map((label) => label.toLowerCase())

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('|')) continue

    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)

    if (cells.length < 2) continue
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue

    const key = cells[0].replace(/\*\*/g, '').trim().toLowerCase()
    if (!normalizedLabels.includes(key)) continue

    const value = cells[1].replace(/\*\*/g, '').trim()
    if (value) return value
  }

  return undefined
}

function normalizeAgentName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const normalized = name
    .replace(/^[A-Za-z0-9_-]+\.md\s*(?:[-—–:|]+\s*)?/i, '')
    .trim()
  return normalized || undefined
}

export function parseField(content: string, keys: string[]): string | undefined {
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

export function parseListField(content: string, keys: string[]): string[] {
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
  const name = normalizeAgentName(
    parseField(agentMd, ['name']) ||
    parseField(identityMd, ['name']) ||
    parseMarkdownTableField(agentMd, ['Agent Name', 'Full Name', 'Name']) ||
    parseMarkdownTableField(identityMd, ['Agent Name', 'Full Name', 'Name']) ||
    firstHeading(agentMd) ||
    firstHeading(identityMd)
  )

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
  openclaw_id: string
  protocol_stack: string
  kpis: string
  deliverables: string
  dependencies: string
  preferred_runtime: string | null
  skills: string
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
           openclaw_id = ?,
           protocol_stack = ?,
           kpis = ?,
           deliverables = ?,
           dependencies = ?,
           preferred_runtime = ?,
           skills = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      params.name,
      params.role || existing.role || 'agent',
      params.soulContent ?? existing.soul_content,
      params.contentHash,
      params.workspacePath,
      mergeConfig(existing.config, params.config),
      params.openclaw_id,
      params.protocol_stack,
      params.kpis,
      params.deliverables,
      params.dependencies,
      params.preferred_runtime,
      params.skills,
      now,
      existing.id
    )

    return existing.id
  }

  const result = db.prepare(
    `INSERT INTO agents (
      name, role, soul_content, status, created_at, updated_at, config, workspace_id, source, content_hash, workspace_path,
      openclaw_id, protocol_stack, kpis, deliverables, dependencies, preferred_runtime, skills
    ) VALUES (?, ?, ?, 'offline', ?, ?, ?, ?, 'filesystem', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.name,
    params.role || 'agent',
    params.soulContent,
    now,
    now,
    JSON.stringify(params.config),
    params.workspaceId,
    params.contentHash,
    params.workspacePath,
    params.openclaw_id,
    params.protocol_stack,
    params.kpis,
    params.deliverables,
    params.dependencies,
    params.preferred_runtime,
    params.skills
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
      workspace_id, external_id, name, description, color, manager_agent_id, source, source_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'filesystem', ?, ?, ?)
    ON CONFLICT(workspace_id, external_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      manager_agent_id = excluded.manager_agent_id,
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
      role = CASE
        WHEN agent_team_assignments.source = 'manual' THEN agent_team_assignments.role
        ELSE excluded.role
      END,
      assigned_at = excluded.assigned_at,
      source = CASE
        WHEN agent_team_assignments.source = 'manual' THEN 'manual'
        ELSE excluded.source
      END
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
        department.manager_agent_id ?? null,
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

  const syncFilesystemAgentFromPath = (
    agentPath: string,
    defaults: { departmentName: string; teamName?: string }
  ): { agentId: number; assignmentRole: 'member' | 'lead' } => {
    const agentDirName = path.basename(agentPath)
    const agentMd = safeRead(path.join(agentPath, 'AGENT.md'))
    const identityMd = safeRead(path.join(agentPath, 'IDENTITY.md'))
    const soulMd = safeRead(path.join(agentPath, 'SOUL.md'))
    const userMd = safeRead(path.join(agentPath, 'USER.md'))
    const metadata = parseAgentProfile(agentDirName, agentMd, identityMd)
    const agentName = metadata.name || agentDirName
    const agentRole = metadata.role || 'agent'
    const contentHash = buildAgentContentHash([agentMd, identityMd, soulMd, userMd, agentPath])
    const folderOrg: Record<string, unknown> = {
      department: metadata.department || defaults.departmentName,
      path: agentPath,
    }
    if (defaults.teamName) {
      folderOrg.team = metadata.team || defaults.teamName
    }

    const agentId = ensureFilesystemAgent({
      workspaceId,
      name: agentName,
      role: agentRole,
      soulContent: soulMd || agentMd || identityMd || null,
      contentHash,
      workspacePath: agentPath,
      config: { orgSource: 'filesystem', folderOrg },
      openclaw_id: metadata.openclaw_id,
      protocol_stack: JSON.stringify(metadata.protocol_stack),
      kpis: JSON.stringify(metadata.kpis),
      deliverables: JSON.stringify(metadata.deliverables),
      dependencies: JSON.stringify(metadata.dependencies),
      preferred_runtime: metadata.preferred_runtime ?? null,
      skills: JSON.stringify(metadata.skills),
    })

    return {
      agentId,
      assignmentRole: metadata.assignmentRole || 'member',
    }
  }

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

      const departmentSubdirectories = safeDirectories(departmentPath)
      const departmentMetadata = readDepartmentMetadata(departmentPath)
      const teamNames = departmentSubdirectories.filter(
        (name) => !RESERVED_DEPARTMENT_SUBDIRS.has(name)
      )

      for (const teamName of teamNames) {
        const teamPath = path.join(departmentPath, teamName)
        const teamId = stableNumber(`team:${teamPath}`)
        const teamColor = colorForKey(`team:${teamName}`)
        const teamMetadata = readTeamMetadata(teamPath)

        teams.push({
          id: teamId,
          name: teamName,
          description: `Synced from ${path.relative(resolvedRoot, teamPath) || teamName}`,
          department_id: departmentId,
          color: teamColor,
          created_at: startedAt,
          updated_at: startedAt,
        })

        const teamMembers: Array<{ dirName: string; agentId: number; assignmentRole: 'member' | 'lead' }> = []
        for (const agentDirName of safeDirectories(teamPath)) {
          const agentPath = path.join(teamPath, agentDirName)
          const { agentId, assignmentRole } = syncFilesystemAgentFromPath(agentPath, {
            departmentName,
            teamName,
          })
          teamMembers.push({
            dirName: agentDirName,
            agentId,
            assignmentRole,
          })

          agentAssignments.push({
            agent_id: agentId,
            team_id: teamId,
            role: assignmentRole,
            assigned_at: startedAt,
          })
        }

        if (teamMetadata.lead_agent_dir) {
          const leadDirName = path.basename(teamMetadata.lead_agent_dir)
          const leadAgentId = teamMembers.find((member) => member.dirName === leadDirName)?.agentId

          if (leadAgentId != null) {
            for (const assignment of agentAssignments) {
              if (assignment.team_id !== teamId) continue
              assignment.role = assignment.agent_id === leadAgentId ? 'lead' : 'member'
            }
          }
        }
      }

      const fallbackManagerDir = departmentSubdirectories.includes('MANAGER')
        ? safeDirectories(path.join(departmentPath, 'MANAGER'))[0]
        : undefined
      const managerAgentDir = departmentMetadata.manager_agent_dir ??
        (fallbackManagerDir ? path.join('MANAGER', fallbackManagerDir) : undefined)

      if (managerAgentDir) {
        const managerAgentPath = path.resolve(departmentPath, managerAgentDir)
        if (
          managerAgentPath !== departmentPath &&
          existsSync(managerAgentPath) &&
          statSync(managerAgentPath).isDirectory()
        ) {
          const { agentId: managerAgentId } = syncFilesystemAgentFromPath(managerAgentPath, {
            departmentName,
          })
          const department = departments.find((entry) => entry.id === departmentId)
          if (department) {
            department.manager_agent_id = managerAgentId
          }
        }
      }
    }
  })

  syncTxn()
  applyFilesystemOrgPersistence(workspaceId, resolvedRoot, departments, teams, agentAssignments)

  const leadRows = db.prepare(
    `SELECT external_id, manager_agent_id FROM departments WHERE workspace_id = ?`
  ).all(workspaceId) as Array<{ external_id: number; manager_agent_id: number | null }>
  const leadMap = new Map(leadRows.map((row) => [row.external_id, row.manager_agent_id]))
  for (const department of departments) {
    const leadId = leadMap.get(department.id)
    if (leadId != null) {
      department.manager_agent_id = leadId
    }
  }

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
