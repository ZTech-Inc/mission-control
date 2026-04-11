export type TaskMetadata = Record<string, unknown>

export interface TaskLike {
  metadata?: string | TaskMetadata | null
}

export interface TaskImplementationTarget {
  implementation_repo?: string
  code_location?: string
}

export interface TaskHierarchyAgent {
  id: number
  name: string
  role: string
  config?: string | Record<string, unknown> | null
}

export interface TaskHierarchyDepartmentManager {
  department_external_id: number
  agent_id: number
}

export interface TaskHierarchyAssignment {
  agent_id: number
  team_external_id: number
  department_external_id: number
  role: 'member' | 'lead'
}

export interface TaskHierarchyDecision {
  candidateAgentIds: number[]
  originAgentName: string
  stage: 'department_manager' | 'team_lead' | 'individual_contributor'
  reason: string
  departmentExternalId?: number
  teamExternalId?: number
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseTaskMetadata(metadata: TaskLike['metadata']): TaskMetadata {
  if (!metadata) return {}

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as TaskMetadata
      }
      return {}
    } catch {
      return {}
    }
  }

  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata
  }

  return {}
}

export function resolveTaskImplementationTarget(task: TaskLike): TaskImplementationTarget {
  const metadata = parseTaskMetadata(task.metadata)

  const implementationRepoCandidates = [
    metadata.implementation_repo,
    metadata.implementationRepo,
    metadata.github_repo,
  ]

  const codeLocationCandidates = [
    metadata.code_location,
    metadata.codeLocation,
    metadata.path,
  ]

  const implementation_repo = implementationRepoCandidates.find(isNonEmptyString)
  const code_location = codeLocationCandidates.find(isNonEmptyString)

  return {
    ...(implementation_repo ? { implementation_repo } : {}),
    ...(code_location ? { code_location } : {}),
  }
}

function normalizeName(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase()
}

function getStringMetadata(metadata: TaskMetadata, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key]
    if (isNonEmptyString(value)) return value.trim()
  }
  return undefined
}

function getNumberMetadata(metadata: TaskMetadata, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function parseAgentConfig(agent: TaskHierarchyAgent): Record<string, unknown> {
  if (!agent.config) return {}
  if (typeof agent.config === 'string') {
    try {
      const parsed = JSON.parse(agent.config) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return {}
    } catch {
      return {}
    }
  }
  if (typeof agent.config === 'object' && !Array.isArray(agent.config)) {
    return agent.config as Record<string, unknown>
  }
  return {}
}

export function isExecutiveHierarchyAgent(agent: TaskHierarchyAgent): boolean {
  const normalizedName = normalizeName(agent.name)
  if (normalizedName === 'ceo' || normalizedName === 'cto') return true

  const config = parseAgentConfig(agent)
  return (
    config.executive === true ||
    config.admin === true ||
    config.isAdmin === true ||
    config.orgHead === true ||
    config.taskRoutingTier === 'executive' ||
    config.orgTier === 'executive' ||
    config.orgTier === 'org-head'
  )
}

function uniqueIds(values: number[]): number[] {
  return [...new Set(values)]
}

export function resolveTaskHierarchyDecision(
  task: TaskLike & { created_by?: string | null },
  agents: TaskHierarchyAgent[],
  departmentManagers: TaskHierarchyDepartmentManager[],
  assignments: TaskHierarchyAssignment[],
): TaskHierarchyDecision | null {
  const metadata = parseTaskMetadata(task.metadata)
  const originName =
    getStringMetadata(metadata, [
      'routing_origin_agent',
      'origin_agent',
      'originAgent',
      'creator_agent',
      'creatorAgent',
      'source_agent',
      'sourceAgent',
    ]) ||
    (isNonEmptyString(task.created_by) ? task.created_by.trim() : '')

  if (!originName) return null

  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const originAgent = agents.find((agent) => normalizeName(agent.name) === normalizeName(originName))
  if (!originAgent) return null

  const departmentHint = getNumberMetadata(metadata, [
    'routing_department_external_id',
    'routingDepartmentExternalId',
    'department_external_id',
    'departmentExternalId',
  ])
  const teamHint = getNumberMetadata(metadata, [
    'routing_team_external_id',
    'routingTeamExternalId',
    'team_external_id',
    'teamExternalId',
  ])

  const explicitManagers = departmentManagers.filter((entry) => agentById.has(entry.agent_id))
  const leadAssignments = assignments.filter((assignment) => assignment.role === 'lead' && agentById.has(assignment.agent_id))
  const memberAssignments = assignments.filter((assignment) => assignment.role === 'member' && agentById.has(assignment.agent_id))

  const managedDepartmentsByAgent = new Map<number, number[]>()
  for (const entry of explicitManagers) {
    const current = managedDepartmentsByAgent.get(entry.agent_id) ?? []
    current.push(entry.department_external_id)
    managedDepartmentsByAgent.set(entry.agent_id, current)
  }

  const leadTeamsByAgent = new Map<number, TaskHierarchyAssignment[]>()
  for (const assignment of leadAssignments) {
    const current = leadTeamsByAgent.get(assignment.agent_id) ?? []
    current.push(assignment)
    leadTeamsByAgent.set(assignment.agent_id, current)
  }

  if (isExecutiveHierarchyAgent(originAgent)) {
    const managerCandidates = explicitManagers
      .filter((entry) => entry.agent_id !== originAgent.id)
      .filter((entry) => departmentHint == null || entry.department_external_id === departmentHint)
      .map((entry) => entry.agent_id)
    if (managerCandidates.length > 0) {
      return {
        candidateAgentIds: uniqueIds(managerCandidates),
        originAgentName: originAgent.name,
        stage: 'department_manager',
        reason: 'executive_to_department_manager',
        ...(departmentHint != null ? { departmentExternalId: departmentHint } : {}),
      }
    }

    const leadCandidates = leadAssignments
      .filter((entry) => entry.agent_id !== originAgent.id)
      .filter((entry) => departmentHint == null || entry.department_external_id === departmentHint)
      .filter((entry) => teamHint == null || entry.team_external_id === teamHint)
      .map((entry) => entry.agent_id)
    if (leadCandidates.length > 0) {
      return {
        candidateAgentIds: uniqueIds(leadCandidates),
        originAgentName: originAgent.name,
        stage: 'team_lead',
        reason: 'executive_fallback_team_lead',
        ...(departmentHint != null ? { departmentExternalId: departmentHint } : {}),
        ...(teamHint != null ? { teamExternalId: teamHint } : {}),
      }
    }
  }

  const managedDepartments = managedDepartmentsByAgent.get(originAgent.id) ?? []
  if (managedDepartments.length > 0) {
    const allowedDepartments =
      departmentHint != null && managedDepartments.includes(departmentHint)
        ? [departmentHint]
        : managedDepartments

    const leadCandidates = leadAssignments
      .filter((entry) => entry.agent_id !== originAgent.id)
      .filter((entry) => allowedDepartments.includes(entry.department_external_id))
      .filter((entry) => teamHint == null || entry.team_external_id === teamHint)
      .map((entry) => entry.agent_id)
    if (leadCandidates.length > 0) {
      return {
        candidateAgentIds: uniqueIds(leadCandidates),
        originAgentName: originAgent.name,
        stage: 'team_lead',
        reason: 'department_manager_to_team_lead',
        ...(allowedDepartments.length === 1 ? { departmentExternalId: allowedDepartments[0] } : {}),
        ...(teamHint != null ? { teamExternalId: teamHint } : {}),
      }
    }

    const memberCandidates = memberAssignments
      .filter((entry) => entry.agent_id !== originAgent.id)
      .filter((entry) => allowedDepartments.includes(entry.department_external_id))
      .filter((entry) => teamHint == null || entry.team_external_id === teamHint)
      .map((entry) => entry.agent_id)
    if (memberCandidates.length > 0) {
      return {
        candidateAgentIds: uniqueIds(memberCandidates),
        originAgentName: originAgent.name,
        stage: 'individual_contributor',
        reason: 'department_manager_fallback_member',
        ...(allowedDepartments.length === 1 ? { departmentExternalId: allowedDepartments[0] } : {}),
        ...(teamHint != null ? { teamExternalId: teamHint } : {}),
      }
    }
  }

  const leadTeams = leadTeamsByAgent.get(originAgent.id) ?? []
  if (leadTeams.length > 0) {
    const allowedTeams =
      teamHint != null && leadTeams.some((entry) => entry.team_external_id === teamHint)
        ? leadTeams.filter((entry) => entry.team_external_id === teamHint)
        : leadTeams

    const memberCandidates = memberAssignments
      .filter((entry) => entry.agent_id !== originAgent.id)
      .filter((entry) => allowedTeams.some((lead) => lead.team_external_id === entry.team_external_id))
      .map((entry) => entry.agent_id)

    if (memberCandidates.length > 0) {
      const selectedTeam = allowedTeams.length === 1 ? allowedTeams[0] : undefined
      return {
        candidateAgentIds: uniqueIds(memberCandidates),
        originAgentName: originAgent.name,
        stage: 'individual_contributor',
        reason: 'team_lead_to_member',
        ...(selectedTeam ? { departmentExternalId: selectedTeam.department_external_id } : {}),
        ...(selectedTeam ? { teamExternalId: selectedTeam.team_external_id } : {}),
      }
    }
  }

  return null
}
