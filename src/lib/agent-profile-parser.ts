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
    parseField(identityMd, ['role', 'theme', 'title'])

  const skills = [
    ...parseListField(agentMd, ['skills', 'capabilities']),
    ...parseListField(identityMd, ['skills', 'capabilities']),
  ]

  const kpis = [
    ...parseListField(agentMd, ['kpis', 'goals', 'metrics']),
    ...parseListField(identityMd, ['kpis', 'goals', 'metrics']),
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
    ...parseListField(identityMd, ['protocol_stack', 'protocols', 'protocol stack']),
  ]

  const deliverables = [
    ...parseListField(agentMd, ['deliverables', 'outputs']),
    ...parseListField(identityMd, ['deliverables', 'outputs']),
  ]

  const dependencies_parsed = [
    ...parseListField(agentMd, ['dependencies', 'depends_on', 'depends on']),
    ...parseListField(identityMd, ['dependencies', 'depends_on', 'depends on']),
  ]

  const preferred_runtime =
    parseField(agentMd, ['preferred_runtime', 'preferred runtime', 'runtime']) ||
    parseField(identityMd, ['preferred_runtime', 'preferred runtime', 'runtime'])

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
