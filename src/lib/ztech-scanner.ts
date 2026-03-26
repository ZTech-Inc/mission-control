import 'server-only'
import fs from 'fs'
import path from 'path'
import type { Department, Team, AgentTeamAssignment, DocFile, OrgAgent } from '@/store/index'

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ScanResult {
  departments: Department[]
  teams: Team[]
  orgAgents: OrgAgent[]
  agentTeamAssignments: AgentTeamAssignment[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEPT_SKIP = new Set(['_skills_library', '.git'])

const COLOR_PALETTE = [
  '#89b4fa','#cba6f7','#a6e3a1','#f9e2af','#f38ba8','#74c7ec',
  '#f5c2e7','#94e2d5','#fab387','#eba0ac','#89dceb','#b4befe',
  '#a6d189','#e78284','#ef9f76','#ca9ee6','#81c8be','#e5c890',
]

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** djb2 hash → deterministic positive 31-bit integer */
function stableId(relativePath: string): number {
  let hash = 5381
  for (let i = 0; i < relativePath.length; i++) {
    hash = ((hash << 5) + hash) ^ relativePath.charCodeAt(i)
    hash = hash >>> 0 // keep unsigned 32-bit
  }
  // Mask to 31 bits and ensure positive (avoid 0)
  const result = (hash & 0x7fffffff) || 1
  return result
}

/** Format directory name → human-readable (underscores → spaces) */
function formatName(dirName: string): string {
  return dirName.replace(/_/g, ' ')
}

/** Parse metadata from AGENT.md markdown table rows `| **Key** | Value |` */
function parseAgentMd(content: string): {
  name?: string
  role?: string
  skills: string[]
  deliverables: string[]
  kpi?: string
} {
  const result: { name?: string; role?: string; skills: string[]; deliverables: string[]; kpi?: string } = {
    skills: [],
    deliverables: [],
  }

  // Extract table row values: | **Key** | Value |
  const tableRowRe = /\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+)\|/g
  let match: RegExpExecArray | null
  while ((match = tableRowRe.exec(content)) !== null) {
    const key = match[1].trim().toLowerCase()
    const value = match[2].trim()
    if (key === 'agent name') result.name = value
    else if (key === 'role / title' || key === 'role/title' || key === 'role') result.role = value
    else if (key === 'kpi') result.kpi = value
  }

  // Parse ## Core Skills bullet list
  const skillsSection = content.match(/##\s+Core Skills\s*\n([\s\S]*?)(?=\n##|\s*$)/)
  if (skillsSection) {
    const bullets = skillsSection[1].match(/^-\s+(.+)$/gm)
    if (bullets) {
      result.skills = bullets.map((b) => b.replace(/^-\s+/, '').trim()).filter(Boolean)
    }
  }

  // Parse ## Key Deliverables bullet list
  const delivSection = content.match(/##\s+Key Deliverables\s*\n([\s\S]*?)(?=\n##|\s*$)/)
  if (delivSection) {
    const bullets = delivSection[1].match(/^-\s+(.+)$/gm)
    if (bullets) {
      result.deliverables = bullets.map((b) => b.replace(/^-\s+/, '').trim()).filter(Boolean)
    }
    // Also handle comma-separated on same line
    if (result.deliverables.length === 0) {
      const inline = delivSection[1].trim()
      if (inline) result.deliverables = inline.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }

  return result
}

/** Walk the ZTech_Agents filesystem and build the full ScanResult */
function scanZTechAgents(): ScanResult {
  const ztechPath = process.env.ZTECH_AGENTS_PATH
  if (!ztechPath) {
    console.warn('[ztech-scanner] ZTECH_AGENTS_PATH is not set — returning empty org data')
    return { departments: [], teams: [], orgAgents: [], agentTeamAssignments: [] }
  }

  const resolvedRoot = path.resolve(ztechPath)
  try {
    const stat = fs.statSync(resolvedRoot)
    if (!stat.isDirectory()) {
      console.warn(`[ztech-scanner] ZTECH_AGENTS_PATH is not a directory: ${resolvedRoot}`)
      return { departments: [], teams: [], orgAgents: [], agentTeamAssignments: [] }
    }
  } catch {
    console.warn(`[ztech-scanner] ZTECH_AGENTS_PATH does not exist or is not accessible: ${resolvedRoot}`)
    return { departments: [], teams: [], orgAgents: [], agentTeamAssignments: [] }
  }

  const now = Math.floor(Date.now() / 1000)

  // Collect all dept dir names, sort for deterministic color assignment
  let deptDirNames: string[] = []
  try {
    deptDirNames = fs.readdirSync(resolvedRoot).filter((name) => {
      if (name.startsWith('.')) return false
      if (DEPT_SKIP.has(name)) return false
      try {
        return fs.statSync(path.join(resolvedRoot, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch (err) {
    console.warn('[ztech-scanner] Failed to read ZTECH_AGENTS_PATH:', err)
    return { departments: [], teams: [], orgAgents: [], agentTeamAssignments: [] }
  }

  deptDirNames.sort()

  const departments: Department[] = []
  const teams: Team[] = []
  const orgAgents: OrgAgent[] = []
  const agentTeamAssignments: AgentTeamAssignment[] = []

  for (let di = 0; di < deptDirNames.length; di++) {
    const deptDirName = deptDirNames[di]
    const deptRelPath = deptDirName
    const deptId = stableId(deptRelPath)
    const color = COLOR_PALETTE[di % COLOR_PALETTE.length]

    departments.push({
      id: deptId,
      name: formatName(deptDirName),
      color,
      dir_name: deptDirName,
      created_at: now,
      updated_at: now,
    })

    // Level 2: teams
    const deptAbsPath = path.join(resolvedRoot, deptDirName)
    let teamDirNames: string[] = []
    try {
      teamDirNames = fs.readdirSync(deptAbsPath).filter((name) => {
        if (name.startsWith('.')) return false
        try {
          return fs.statSync(path.join(deptAbsPath, name)).isDirectory()
        } catch {
          return false
        }
      })
    } catch (err) {
      console.warn(`[ztech-scanner] Failed to read department directory ${deptAbsPath}:`, err)
      continue
    }

    for (const teamDirName of teamDirNames) {
      const teamRelPath = `${deptDirName}/${teamDirName}`
      const teamId = stableId(teamRelPath)

      teams.push({
        id: teamId,
        name: formatName(teamDirName),
        department_id: deptId,
        color,
        dir_name: teamDirName,
        created_at: now,
        updated_at: now,
      })

      // Level 3: agents
      const teamAbsPath = path.join(deptAbsPath, teamDirName)
      let agentDirNames: string[] = []
      try {
        agentDirNames = fs.readdirSync(teamAbsPath).filter((name) => {
          if (name.startsWith('.')) return false
          try {
            return fs.statSync(path.join(teamAbsPath, name)).isDirectory()
          } catch {
            return false
          }
        })
      } catch (err) {
        console.warn(`[ztech-scanner] Failed to read team directory ${teamAbsPath}:`, err)
        continue
      }

      for (const agentDirName of agentDirNames) {
        const agentRelPath = `${deptDirName}/${teamDirName}/${agentDirName}`
        const agentId = stableId(agentRelPath)
        const agentAbsPath = path.join(teamAbsPath, agentDirName)

        let agentMeta: ReturnType<typeof parseAgentMd> = { skills: [], deliverables: [] }
        const agentMdPath = path.join(agentAbsPath, 'AGENT.md')
        try {
          if (fs.existsSync(agentMdPath)) {
            const content = fs.readFileSync(agentMdPath, 'utf-8')
            agentMeta = parseAgentMd(content)
          }
        } catch (err) {
          console.warn(`[ztech-scanner] Failed to read AGENT.md at ${agentMdPath}:`, err)
        }

        const agentName = agentMeta.name ?? formatName(agentDirName)
        const agentRole = agentMeta.role ?? 'Agent'

        orgAgents.push({
          id: agentId,
          name: agentName,
          role: agentRole,
          department_id: deptId,
          team_id: teamId,
          dir_path: agentRelPath,
          skills: agentMeta.skills,
          deliverables: agentMeta.deliverables,
          kpi: agentMeta.kpi,
          status: 'idle',
          created_at: now,
          updated_at: now,
        })

        agentTeamAssignments.push({
          agent_id: agentId,
          team_id: teamId,
          role: 'member',
          assigned_at: now,
        })
      }
    }
  }

  return { departments, teams, orgAgents, agentTeamAssignments }
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000

let cache: ScanResult | null = null
let cacheExpiresAt = 0

/** Returns cached org data, refreshed at most every 30 seconds. Never throws. */
export function getOrgData(): ScanResult {
  const now = Date.now()
  if (cache && now < cacheExpiresAt) return cache
  try {
    cache = scanZTechAgents()
    cacheExpiresAt = now + CACHE_TTL_MS
  } catch (err) {
    console.warn('[ztech-scanner] scanZTechAgents threw unexpectedly:', err)
    if (!cache) cache = { departments: [], teams: [], orgAgents: [], agentTeamAssignments: [] }
  }
  return cache
}

// ─── Doc Tree ────────────────────────────────────────────────────────────────

/** Build a DocFile tree for a department (and optionally a single team). */
export function buildDocTree(deptDirName: string, teamDirName?: string): DocFile[] {
  const ztechPath = process.env.ZTECH_AGENTS_PATH
  if (!ztechPath) return []

  const resolvedRoot = path.resolve(ztechPath)

  const buildSubtree = (absDir: string, relBase: string): DocFile[] => {
    const result: DocFile[] = []
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return result
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const entryRelPath = `${relBase}/${entry.name}`
      const entryAbsPath = path.join(absDir, entry.name)

      if (entry.isDirectory()) {
        // Skip 'agents' and 'skills' subdirs per spec
        const lname = entry.name.toLowerCase()
        if (lname === 'agents' || lname === 'skills') continue

        const children = buildSubtree(entryAbsPath, entryRelPath)
        result.push({
          path: entryRelPath,
          name: formatName(entry.name),
          type: 'directory',
          children,
        })
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const stat = fs.statSync(entryAbsPath)
          result.push({
            path: entryRelPath,
            name: entry.name,
            type: 'file',
            size: stat.size,
            modified: Math.floor(stat.mtimeMs / 1000),
          })
        } catch {
          // skip unreadable files
        }
      }
    }

    return result
  }

  // Validate deptDirName stays within resolvedRoot
  const resolvedDept = path.resolve(resolvedRoot, deptDirName)
  if (!resolvedDept.startsWith(resolvedRoot + path.sep)) {
    console.warn(`[ztech-scanner] buildDocTree: path traversal attempt blocked for dept: ${deptDirName}`)
    return []
  }

  // Validate teamDirName stays within resolvedRoot
  if (teamDirName !== undefined) {
    const resolvedTeam = path.resolve(resolvedDept, teamDirName)
    if (!resolvedTeam.startsWith(resolvedRoot + path.sep)) {
      console.warn(`[ztech-scanner] buildDocTree: path traversal attempt blocked for team: ${teamDirName}`)
      return []
    }
  }

  try {
    if (teamDirName) {
      const teamAbs = path.join(resolvedRoot, deptDirName, teamDirName)
      const teamRel = `${deptDirName}/${teamDirName}`
      const children = buildSubtree(teamAbs, teamRel)
      return [{
        path: teamRel,
        name: formatName(teamDirName),
        type: 'directory',
        children,
      }]
    } else {
      const deptAbs = path.join(resolvedRoot, deptDirName)
      const deptRel = deptDirName
      const children = buildSubtree(deptAbs, deptRel)
      return [{
        path: deptRel,
        name: formatName(deptDirName),
        type: 'directory',
        children,
      }]
    }
  } catch (err) {
    console.warn('[ztech-scanner] buildDocTree error:', err)
    return []
  }
}

// ─── Safe File Reader ─────────────────────────────────────────────────────────

/** Read a file relative to ZTECH_AGENTS_PATH. Returns '' on error. */
export function readDocContent(relativePath: string): string {
  const ztechPath = process.env.ZTECH_AGENTS_PATH
  if (!ztechPath) return ''

  try {
    const resolvedRoot = path.resolve(ztechPath)
    const resolvedFile = path.resolve(resolvedRoot, relativePath)

    // Path traversal protection
    if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
      console.warn(`[ztech-scanner] readDocContent: path traversal attempt blocked: ${relativePath}`)
      return ''
    }

    // Symlink traversal protection — lstat does not follow symlinks
    const lstat = fs.lstatSync(resolvedFile)
    if (lstat.isSymbolicLink()) {
      console.warn(`[ztech-scanner] readDocContent: symlink traversal attempt blocked: ${relativePath}`)
      return ''
    }

    return fs.readFileSync(resolvedFile, 'utf-8')
  } catch {
    return ''
  }
}
