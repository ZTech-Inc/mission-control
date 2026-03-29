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
  snapshot: OrgSnapshot | null
}

const globalCache = globalThis as typeof globalThis & { __orgSnapshotCache?: CacheState }
const cache = globalCache.__orgSnapshotCache ?? { snapshot: null }
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

function safeDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
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
  const pattern = new RegExp(`^(?:${keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*:\\s*(.+)$`, 'i')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    const match = line.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
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

  const assignmentRole = assignmentValue === 'lead' ? 'lead' : 'member'

  return {
    name: name || agentName,
    role,
    assignmentRole,
  }
}

function buildAgentContentHash(parts: string[]): string {
  return createHash('sha1').update(parts.join('\n---\n'), 'utf8').digest('hex')
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
  const existing = db
    .prepare(
      `SELECT id, name, role, soul_content, source, content_hash, workspace_path, config
       FROM agents
       WHERE workspace_id = ? AND name = ?`
    )
    .get(params.workspaceId, params.name) as DbAgentRow | undefined

  if (existing) {
    const mergedConfig = (() => {
      try {
        const parsed = existing.config ? JSON.parse(existing.config) : {}
        return JSON.stringify({ ...parsed, ...params.config })
      } catch {
        return JSON.stringify(params.config)
      }
    })()

    db.prepare(
      `UPDATE agents
       SET role = ?, soul_content = ?, source = 'filesystem', content_hash = ?, workspace_path = ?, config = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      params.role || existing.role || 'agent',
      params.soulContent ?? existing.soul_content,
      params.contentHash,
      params.workspacePath,
      mergedConfig,
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
                department: departmentName,
                team: teamName,
                path: agentPath,
              },
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

  return {
    departments,
    teams,
    agentAssignments,
    source: ORG_SOURCE_FILESYSTEM,
    rootPath: resolvedRoot,
    scannedAt: startedAt,
  }
}

export function invalidateOrgSnapshot(): void {
  cache.snapshot = null
}

export function getOrgSnapshot(options?: { force?: boolean; workspaceId?: number }): OrgSnapshot {
  const force = options?.force === true
  const workspaceId = options?.workspaceId ?? 1

  if (!force && cache.snapshot) {
    return cache.snapshot
  }

  const agentsDir = config.agentsDir?.trim()
  if (!agentsDir) {
    const snapshot = fallbackSnapshot()
    cache.snapshot = snapshot
    return snapshot
  }

  if (!existsSync(agentsDir)) {
    logger.warn({ agentsDir }, 'AGENTS_DIR does not exist, using mock org data')
    const snapshot = fallbackSnapshot()
    cache.snapshot = snapshot
    return snapshot
  }

  try {
    const stat = statSync(agentsDir)
    if (!stat.isDirectory()) {
      logger.warn({ agentsDir }, 'AGENTS_DIR is not a directory, using mock org data')
      const snapshot = fallbackSnapshot()
      cache.snapshot = snapshot
      return snapshot
    }

    const snapshot = scanFilesystemOrg(agentsDir, workspaceId)
    cache.snapshot = snapshot
    return snapshot
  } catch (error) {
    logger.error({ err: error, agentsDir }, 'Failed to scan AGENTS_DIR, using mock org data')
    const snapshot = fallbackSnapshot()
    cache.snapshot = snapshot
    return snapshot
  }
}
