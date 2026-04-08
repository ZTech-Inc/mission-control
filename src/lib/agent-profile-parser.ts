import {
  parseField,
  parseListField,
  parseMarkdownTableField,
  type ParsedAgentMetadata,
} from './org-scanner'

export type { ParsedAgentMetadata }

export interface ParsedAgentProfile extends ParsedAgentMetadata {
  protocol_stack: string[]
  deliverables: string[]
  dependencies: string[]
  preferred_runtime: string | undefined
  openclaw_id: string
}

function normalizeAgentName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const normalized = name
    .replace(/^[A-Za-z0-9_-]+\.md\s*(?:[-—–:|]+\s*)?/i, '')
    .trim()
  return normalized || undefined
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

function normalizeSectionName(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
}

function getSection(content: string, headings: string[]): string[] {
  const targetHeadings = new Set(headings.map(normalizeSectionName))
  const lines = content.split('\n')
  const collected: string[] = []
  let inSection = false

  for (const rawLine of lines) {
    const headingMatch = rawLine.match(/^##+\s+(.+)$/)
    if (headingMatch) {
      const heading = normalizeSectionName(headingMatch[1] || '')
      if (inSection) break
      inSection = targetHeadings.has(heading)
      continue
    }

    if (inSection) collected.push(rawLine)
  }

  return collected
}

function parseTableCells(line: string): string[] {
  return line
    .split('|')
    .map((cell) => cell.trim().replace(/\*\*/g, ''))
    .filter(Boolean)
}

function parseSectionList(
  content: string,
  headings: string[],
  options?: {
    tableColumn?: number
    ignoredTableHeaders?: string[]
    includeColonValues?: boolean
  }
): string[] {
  const lines = getSection(content, headings)
  if (lines.length === 0) return []

  const items: string[] = []
  const plainLines: string[] = []
  const ignoredTableHeaders = new Set(
    (options?.ignoredTableHeaders ?? []).map((header) => header.trim().toLowerCase())
  )

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const bulletMatch = line.match(/^[-*]\s+(.+)$/)
    if (bulletMatch?.[1]) {
      const bulletValue = bulletMatch[1].replace(/\*\*/g, '').trim()
      if (options?.includeColonValues) {
        const colonIndex = bulletValue.indexOf(':')
        items.push((colonIndex >= 0 ? bulletValue.slice(colonIndex + 1) : bulletValue).trim())
      } else {
        items.push(bulletValue)
      }
      continue
    }

    if (line.startsWith('|')) {
      const cells = parseTableCells(line)
      if (cells.length < 2) continue
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue

      const headerCell = (cells[0] || '').toLowerCase()
      if (ignoredTableHeaders.has(headerCell)) continue

      const selectedCell = cells[options?.tableColumn ?? 1]
      if (selectedCell) items.push(selectedCell.trim())
      continue
    }

    plainLines.push(line.replace(/\*\*/g, '').trim())
  }

  if (items.length > 0) return [...new Set(items.filter(Boolean))]

  return [
    ...new Set(
      plainLines
        .flatMap((line) => line.split(/[;,]/))
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ]
}

function parseSectionValue(
  content: string,
  headings: string[],
  keys?: string[]
): string | undefined {
  const lines = getSection(content, headings)
  if (lines.length === 0) return undefined

  const normalizedKeys = (keys ?? []).map((key) => normalizeSectionName(key))

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const bulletMatch = line.match(/^[-*]\s+(.+)$/)
    const candidate = (bulletMatch?.[1] || line).replace(/\*\*/g, '').trim()

    if (normalizedKeys.length > 0) {
      const colonIndex = candidate.indexOf(':')
      if (colonIndex < 0) continue

      const key = normalizeSectionName(candidate.slice(0, colonIndex))
      if (!normalizedKeys.includes(key)) continue

      const value = candidate.slice(colonIndex + 1).trim()
      if (value) return value
      continue
    }

    if (!line.startsWith('|')) return candidate
  }

  return undefined
}

/**
 * Parse an agent's profile from their AGENT.md and IDENTITY.md markdown content.
 *
 * Extracts the standard metadata fields (name, role, skills, kpis, department, team,
 * assignmentRole) plus the Phase 4 enrichment fields (protocol_stack, deliverables,
 * dependencies, preferred_runtime). Derives openclaw_id from the resolved name using
 * the same formula as agent-workspace.ts.
 *
 * @param agentDirName - The agent's directory name (used as fallback for name/openclaw_id)
 * @param agentMd - Contents of AGENT.md (may be empty)
 * @param identityMd - Contents of IDENTITY.md (may be empty)
 */
export function parseAgentProfile(
  agentDirName: string,
  agentMd: string,
  identityMd: string
): ParsedAgentProfile {
  // Standard metadata fields (replicate parseAgentMetadata logic from org-scanner)
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
    parseField(identityMd, ['role', 'theme', 'title']) ||
    parseMarkdownTableField(agentMd, ['Role / Title', 'Role', 'Title']) ||
    parseMarkdownTableField(identityMd, ['Role / Title', 'Role', 'Title'])

  const skills = [
    ...parseListField(agentMd, ['skills', 'capabilities']),
    ...parseSectionList(agentMd, ['Core Skills', 'Skills']),
    ...parseListField(identityMd, ['skills', 'capabilities']),
    ...parseSectionList(identityMd, ['Expertise Domain', 'Skills']),
  ]

  const kpis = [
    ...parseListField(agentMd, ['kpis', 'goals', 'metrics']),
    ...parseSectionList(agentMd, ['KPI', 'KPIs', 'Performance Tracking']),
    ...parseListField(identityMd, ['kpis', 'goals', 'metrics']),
    ...parseSectionList(identityMd, ['KPI', 'KPIs', 'Performance Tracking']),
  ]

  const department =
    parseField(agentMd, ['department']) || parseField(identityMd, ['department'])

  const team = parseField(agentMd, ['team']) || parseField(identityMd, ['team'])

  const assignmentValue = (
    parseField(agentMd, ['assignment_role', 'team_role', 'org_role']) ||
    parseField(identityMd, ['assignment_role', 'team_role', 'org_role']) ||
    ''
  ).toLowerCase()

  const assignmentRole: 'member' | 'lead' = assignmentValue === 'lead' ? 'lead' : 'member'

  // Phase 4 enrichment fields
  const protocol_stack = [
    ...parseListField(agentMd, ['protocol_stack', 'protocols', 'protocol stack']),
    ...parseSectionList(agentMd, ['Protocol Stack', 'Communication Protocols'], {
      tableColumn: 0,
      ignoredTableHeaders: ['protocol'],
    }),
    ...parseListField(identityMd, ['protocol_stack', 'protocols', 'protocol stack']),
    ...parseSectionList(identityMd, ['Protocol Stack', 'Communication Protocols'], {
      tableColumn: 0,
      ignoredTableHeaders: ['protocol'],
    }),
  ]

  const deliverables = [
    ...parseListField(agentMd, ['deliverables', 'outputs']),
    ...parseSectionList(agentMd, ['Key Deliverables', 'Deliverables', 'Outputs']),
    ...parseListField(identityMd, ['deliverables', 'outputs']),
    ...parseSectionList(identityMd, ['Key Deliverables', 'Deliverables', 'Outputs']),
  ]

  const dependencies_parsed = [
    ...parseListField(agentMd, ['dependencies', 'depends_on', 'depends on']),
    ...parseSectionList(agentMd, ['Dependencies'], { includeColonValues: false }),
    ...parseListField(identityMd, ['dependencies', 'depends_on', 'depends on']),
    ...parseSectionList(identityMd, ['Dependencies'], { includeColonValues: false }),
  ]

  const preferred_runtime =
    parseField(agentMd, ['preferred_runtime', 'preferred runtime', 'runtime']) ||
    parseField(identityMd, ['preferred_runtime', 'preferred runtime', 'runtime']) ||
    parseMarkdownTableField(agentMd, ['Preferred Runtime', 'Runtime']) ||
    parseMarkdownTableField(identityMd, ['Preferred Runtime', 'Runtime']) ||
    parseSectionValue(agentMd, ['Operating Parameters'], ['Preferred Runtime', 'Runtime']) ||
    parseSectionValue(identityMd, ['Operating Parameters'], ['Preferred Runtime', 'Runtime'])

  // Derive openclaw_id: use resolved name (or dir name fallback), apply kebab normalization
  // Uses exact formula from agent-workspace.ts line 45
  const rawName = name || agentDirName
  const openclaw_id = rawName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

  return {
    name: name || agentDirName,
    role,
    skills: [...new Set(skills)],
    kpis: [...new Set(kpis)],
    department,
    team,
    assignmentRole,
    protocol_stack: [...new Set(protocol_stack)],
    deliverables: [...new Set(deliverables)],
    dependencies: [...new Set(dependencies_parsed)],
    preferred_runtime,
    openclaw_id,
  }
}
