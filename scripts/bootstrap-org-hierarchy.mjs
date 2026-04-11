import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    workspaceId: 1,
    teamCandidates: null,
    departmentCandidates: null,
    db: null,
    agentsDir: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]

    if (current === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (current === '--force') {
      args.force = true
      continue
    }

    if (current === '--team-candidates') {
      args.teamCandidates = argv[index + 1] ? path.resolve(argv[index + 1]) : null
      index += 1
      continue
    }

    if (current === '--department-candidates') {
      args.departmentCandidates = argv[index + 1] ? path.resolve(argv[index + 1]) : null
      index += 1
      continue
    }

    if (current === '--db') {
      args.db = argv[index + 1] ? path.resolve(argv[index + 1]) : null
      index += 1
      continue
    }

    if (current === '--agents-dir') {
      args.agentsDir = argv[index + 1] ? path.resolve(argv[index + 1]) : null
      index += 1
      continue
    }

    if (current === '--workspace-id') {
      args.workspaceId = Number.parseInt(argv[index + 1] ?? '1', 10)
      index += 1
    }
  }

  return args
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  const stopwords = new Set(['and', 'the', 'of', 'for', 'to', 'a'])
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopwords.has(token))
}

function containsPhrase(haystack, needle) {
  if (!needle) return false
  return haystack.includes(needle)
}

function safeRelativeDir(fromPath, toPath) {
  const relative = path.relative(fromPath, toPath)
  if (!relative || relative === '.' || path.isAbsolute(relative) || relative.startsWith('..')) {
    throw new Error(`Unsafe relative path from "${fromPath}" to "${toPath}"`)
  }
  return relative
}

function isDescendantPath(parentPath, childPath) {
  if (!parentPath || !childPath) return false
  const relative = path.relative(parentPath, childPath)
  return Boolean(relative) && relative !== '.' && !path.isAbsolute(relative) && !relative.startsWith('..')
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function loadTeamCandidateMap(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Map()

  const raw = fs.readFileSync(filePath, 'utf8')
  const rows = JSON.parse(raw)
  const map = new Map()

  for (const row of rows) {
    const top = Array.isArray(row?.top) ? row.top[0] : null
    if (!top?.agent_id) continue

    if (top.team_external_id != null) {
      map.set(`id:${top.team_external_id}`, top.agent_id)
    }

    if (row.department_name && row.team_name) {
      map.set(`name:${row.department_name}::${row.team_name}`, top.agent_id)
    }
  }

  return map
}

function loadDepartmentCandidateMap(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Map()

  const raw = fs.readFileSync(filePath, 'utf8')
  const rows = JSON.parse(raw)
  const map = new Map()

  for (const row of rows) {
    const top = Array.isArray(row?.top) ? row.top[0] : null
    if (!row?.department || !top?.agent_name) continue
    map.set(row.department, normalizeText(top.agent_name))
  }

  return map
}

function scoreRoleSignals(text) {
  let score = 0

  const rules = [
    ['department lead', 260],
    ['team lead', 220],
    ['director', 170],
    ['head', 150],
    ['manager', 130],
    ['architect', 90],
    ['lead', 80],
    ['principal', 55],
    ['senior', 35],
    ['strategist', 25],
    ['coordinator', 20],
    ['specialist', 10],
  ]

  for (const [needle, weight] of rules) {
    if (text.includes(needle)) score += weight
  }

  const penalties = [
    ['assistant', -30],
    ['tier 1', -20],
    ['junior', -35],
    ['intern', -50],
  ]

  for (const [needle, weight] of penalties) {
    if (text.includes(needle)) score += weight
  }

  return score
}

function scoreTeamCandidate(member, team, department) {
  const nameText = normalizeText(member.agent_name)
  const roleText = normalizeText(member.agent_role)
  const fullText = `${nameText} ${roleText}`.trim()
  const teamPhrase = normalizeText(team.team_name)
  const departmentPhrase = normalizeText(department.department_name)
  const teamTokens = tokenize(team.team_name)
  const departmentTokens = tokenize(department.department_name)

  let score = scoreRoleSignals(fullText)

  if (containsPhrase(roleText, teamPhrase)) score += 260
  if (containsPhrase(nameText, teamPhrase)) score += 200
  if (containsPhrase(roleText, departmentPhrase)) score += 50

  let teamTokenMatches = 0
  for (const token of teamTokens) {
    if (containsPhrase(fullText, token)) {
      score += 55
      teamTokenMatches += 1
    }
  }

  for (const token of departmentTokens) {
    if (containsPhrase(fullText, token)) score += 12
  }

  if (member.assignment_role === 'lead') score += 75
  if (teamTokenMatches > 0 && roleText.includes('lead')) score += 120

  return score
}

function scoreDepartmentManagerCandidate(lead, department) {
  const text = normalizeText(`${lead.agent_name} ${lead.agent_role}`)
  const departmentPhrase = normalizeText(department.department_name)
  const departmentTokens = tokenize(department.department_name)

  let score = scoreRoleSignals(text)

  if (containsPhrase(text, departmentPhrase)) score += 140
  for (const token of departmentTokens) {
    if (containsPhrase(text, token)) score += 30
  }

  if (text.includes('department lead')) score += 220
  if (text.includes('director')) score += 140
  if (text.includes('manager')) score += 110
  if (text.includes('head')) score += 120
  if (text.includes('team lead')) score += 40

  return score
}

function groupBy(items, keyFn) {
  const map = new Map()
  for (const item of items) {
    const key = keyFn(item)
    const current = map.get(key)
    if (current) {
      current.push(item)
    } else {
      map.set(key, [item])
    }
  }
  return map
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const agentsDir = args.agentsDir
    ?? process.env.MISSION_CONTROL_AGENTS_DIR
    ?? path.resolve(projectRoot, '..', 'ZTech_Agents')
  const dataDir = process.env.MISSION_CONTROL_DATA_DIR
    ? path.resolve(projectRoot, process.env.MISSION_CONTROL_DATA_DIR)
    : path.join(projectRoot, '.data')
  const dbPath = args.db ?? path.join(dataDir, 'mission-control.db')

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}`)
  }

  if (!fs.existsSync(agentsDir)) {
    throw new Error(`Agents directory not found at ${agentsDir}`)
  }

  const teamCandidateMap = loadTeamCandidateMap(args.teamCandidates)
  const departmentCandidateMap = loadDepartmentCandidateMap(args.departmentCandidates)
  const db = new Database(dbPath)

  const departments = db.prepare(`
    SELECT external_id, name, manager_agent_id, source_path
    FROM departments
    WHERE workspace_id = ?
    ORDER BY name
  `).all(args.workspaceId)

  const teams = db.prepare(`
    SELECT external_id, department_external_id, name, source_path
    FROM teams
    WHERE workspace_id = ?
    ORDER BY name
  `).all(args.workspaceId)

  const members = db.prepare(`
    SELECT
      ata.team_external_id,
      ata.agent_id,
      ata.role AS assignment_role,
      a.name AS agent_name,
      a.role AS agent_role,
      a.workspace_path AS agent_path,
      COALESCE(a.hidden, 0) AS hidden
    FROM agent_team_assignments ata
    JOIN agents a
      ON a.id = ata.agent_id
     AND a.workspace_id = ata.workspace_id
    WHERE ata.workspace_id = ?
    ORDER BY ata.team_external_id, a.name
  `).all(args.workspaceId)

  const departmentsById = new Map(departments.map((row) => [row.external_id, row]))
  const membersByTeam = groupBy(
    members.filter((row) => row.hidden === 0),
    (row) => row.team_external_id
  )
  const departmentMembers = []

  for (const team of teams) {
    const department = departmentsById.get(team.department_external_id)
    const teamMembers = (membersByTeam.get(team.external_id) ?? [])
      .filter((member) => isDescendantPath(team.source_path, member.agent_path))
    for (const member of teamMembers) {
      departmentMembers.push({
        ...member,
        department_external_id: team.department_external_id,
        department_name: department?.name,
        team_name: team.name,
      })
    }
  }

  const membersByDepartment = groupBy(departmentMembers, (row) => row.department_external_id)

  const selectedTeamLeads = new Map()
  const teamLeadSummary = []

  for (const team of teams) {
    const department = departmentsById.get(team.department_external_id)
    const teamMembers = (membersByTeam.get(team.external_id) ?? [])
      .filter((member) => isDescendantPath(team.source_path, member.agent_path))

    if (!department) {
      throw new Error(`Missing department for team ${team.name}`)
    }

    if (teamMembers.length === 0) {
      throw new Error(`Team ${department.name}::${team.name} has no members`)
    }

    const existingLead = teamMembers.find((member) => member.assignment_role === 'lead') ?? null
    if (existingLead && !args.force) {
      selectedTeamLeads.set(team.external_id, existingLead)
      teamLeadSummary.push({
        department: department.name,
        team: team.name,
        agent: existingLead.agent_name,
        role: existingLead.agent_role,
        preserved: true,
      })
      continue
    }

    const preferredAgentId =
      teamCandidateMap.get(`id:${team.external_id}`)
      ?? teamCandidateMap.get(`name:${department.name}::${team.name}`)
      ?? null

    const ranked = [...teamMembers]
      .map((member) => ({
        ...member,
        score: member.agent_id === preferredAgentId
          ? 1_000_000
          : scoreTeamCandidate(member, { team_name: team.name }, { department_name: department.name }),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return String(left.agent_name).localeCompare(String(right.agent_name))
      })

    const winner = ranked[0]
    if (!winner) {
      throw new Error(`No lead candidate found for ${department.name}::${team.name}`)
    }

    selectedTeamLeads.set(team.external_id, winner)
    teamLeadSummary.push({
      department: department.name,
      team: team.name,
      agent: winner.agent_name,
      role: winner.agent_role,
      preserved: false,
      score: winner.score,
    })
  }

  const selectedDepartmentManagers = new Map()
  const departmentSummary = []

  for (const department of departments) {
    const candidates = (membersByDepartment.get(department.external_id) ?? [])
      .filter((candidate) => isDescendantPath(department.source_path, candidate.agent_path))

    if (candidates.length === 0) {
      throw new Error(`Department ${department.name} has no agents to assign as manager`)
    }

    if (department.manager_agent_id != null && !args.force) {
      const preservedManager = candidates.find((candidate) => candidate.agent_id === department.manager_agent_id)
        ?? db.prepare(`
          SELECT id AS agent_id, name AS agent_name, role AS agent_role, workspace_path AS agent_path
          FROM agents
          WHERE workspace_id = ? AND id = ?
          LIMIT 1
        `).get(args.workspaceId, department.manager_agent_id)

      if (!preservedManager?.agent_path) {
        throw new Error(`Existing manager for ${department.name} is missing a workspace path`)
      }

      selectedDepartmentManagers.set(department.external_id, preservedManager)
      departmentSummary.push({
        department: department.name,
        agent: preservedManager.agent_name,
        role: preservedManager.agent_role,
        preserved: true,
      })
      continue
    }

    const preferredManagerName = departmentCandidateMap.get(department.name) ?? null

    const winner = [...candidates]
      .map((candidate) => ({
        ...candidate,
        score: normalizeText(candidate.agent_name) === preferredManagerName
          ? 1_000_000
          : scoreDepartmentManagerCandidate(candidate, { department_name: department.name }),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return String(left.agent_name).localeCompare(String(right.agent_name))
      })[0]

    if (!winner?.agent_path) {
      throw new Error(`No manager candidate found for ${department.name}`)
    }

    selectedDepartmentManagers.set(department.external_id, winner)
    departmentSummary.push({
      department: department.name,
      agent: winner.agent_name,
      role: winner.agent_role,
      preserved: false,
      score: winner.score,
    })
  }

  console.log(`Workspace: ${args.workspaceId}`)
  console.log(`DB: ${dbPath}`)
  console.log(`Agents dir: ${agentsDir}`)
  console.log(`Team leads selected: ${selectedTeamLeads.size}/${teams.length}`)
  console.log(`Department managers selected: ${selectedDepartmentManagers.size}/${departments.length}`)

  if (args.dryRun) {
    console.log('')
    console.log('Department managers:')
    for (const row of departmentSummary) {
      console.log(`- ${row.department}: ${row.agent} | ${row.role}${row.preserved ? ' [preserved]' : ''}`)
    }
    return
  }

  const demoteTeamLead = db.prepare(`
    UPDATE agent_team_assignments
    SET role = 'member', source = 'manual'
    WHERE workspace_id = ? AND team_external_id = ? AND role = 'lead' AND agent_id != ?
  `)

  const upsertTeamLead = db.prepare(`
    INSERT INTO agent_team_assignments (workspace_id, agent_id, team_external_id, role, assigned_at, source)
    VALUES (?, ?, ?, 'lead', unixepoch(), 'manual')
    ON CONFLICT(workspace_id, agent_id, team_external_id) DO UPDATE SET
      role = excluded.role,
      assigned_at = excluded.assigned_at,
      source = excluded.source
  `)

  const updateDepartmentManager = db.prepare(`
    UPDATE departments
    SET manager_agent_id = ?, updated_at = unixepoch()
    WHERE workspace_id = ? AND external_id = ?
  `)

  const apply = db.transaction(() => {
    for (const team of teams) {
      const lead = selectedTeamLeads.get(team.external_id)
      if (!lead?.agent_path) {
        throw new Error(`Selected lead for ${team.name} has no workspace path`)
      }

      demoteTeamLead.run(args.workspaceId, team.external_id, lead.agent_id)
      upsertTeamLead.run(args.workspaceId, lead.agent_id, team.external_id)

      const teamMetadataPath = path.join(team.source_path, '.team.json')
      writeJson(teamMetadataPath, {
        lead_agent_dir: safeRelativeDir(team.source_path, lead.agent_path),
      })
    }

    for (const department of departments) {
      const manager = selectedDepartmentManagers.get(department.external_id)
      if (!manager?.agent_path) {
        throw new Error(`Selected manager for ${department.name} has no workspace path`)
      }

      updateDepartmentManager.run(manager.agent_id, args.workspaceId, department.external_id)

      const departmentMetadataPath = path.join(department.source_path, '.department.json')
      writeJson(departmentMetadataPath, {
        manager_agent_dir: safeRelativeDir(department.source_path, manager.agent_path),
      })
    }
  })

  apply()

  const totalManagers = db.prepare(`
    SELECT COUNT(*) AS count
    FROM departments
    WHERE workspace_id = ? AND manager_agent_id IS NOT NULL
  `).get(args.workspaceId).count

  const totalTeamLeads = db.prepare(`
    SELECT COUNT(*) AS count
    FROM agent_team_assignments
    WHERE workspace_id = ? AND role = 'lead'
  `).get(args.workspaceId).count

  console.log('')
  console.log(`Applied managers: ${totalManagers}/${departments.length}`)
  console.log(`Applied team leads: ${totalTeamLeads}/${teams.length}`)
}

main()
