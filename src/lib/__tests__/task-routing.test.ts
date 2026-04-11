import { describe, it, expect } from 'vitest'
import { resolveTaskImplementationTarget, resolveTaskHierarchyDecision } from '@/lib/task-routing'

describe('resolveTaskImplementationTarget', () => {
  it('returns explicit implementation target metadata when present', () => {
    const result = resolveTaskImplementationTarget({
      metadata: {
        implementation_repo: 'builderz-labs/mission-control',
        code_location: '/apps/api',
      },
    })

    expect(result).toEqual({
      implementation_repo: 'builderz-labs/mission-control',
      code_location: '/apps/api',
    })
  })

  it('supports legacy metadata keys for backward compatibility', () => {
    const result = resolveTaskImplementationTarget({
      metadata: {
        github_repo: 'builderz-labs/mission-control',
        path: '/packages/core',
      },
    })

    expect(result).toEqual({
      implementation_repo: 'builderz-labs/mission-control',
      code_location: '/packages/core',
    })
  })

  it('prefers explicit implementation target metadata over legacy fallback keys', () => {
    const result = resolveTaskImplementationTarget({
      metadata: {
        implementation_repo: 'builderz-labs/mission-control',
        github_repo: 'legacy/repo',
        code_location: '/apps/api',
        path: '/legacy/path',
      },
    })

    expect(result).toEqual({
      implementation_repo: 'builderz-labs/mission-control',
      code_location: '/apps/api',
    })
  })

  it('returns empty object for missing metadata', () => {
    expect(resolveTaskImplementationTarget({ metadata: null })).toEqual({})
  })
})

describe('resolveTaskHierarchyDecision', () => {
  it('routes CEO-created work to department managers first', () => {
    const decision = resolveTaskHierarchyDecision(
      { created_by: 'CEO' },
      [
        { id: 1, name: 'CEO', role: 'Chief Executive Officer' },
        { id: 2, name: 'AI Director', role: 'Department Manager' },
        { id: 3, name: 'Engineering Director', role: 'Department Manager' },
      ],
      [
        { department_external_id: 10, agent_id: 2 },
        { department_external_id: 20, agent_id: 3 },
      ],
      [],
    )

    expect(decision).toEqual({
      candidateAgentIds: [2, 3],
      originAgentName: 'CEO',
      stage: 'department_manager',
      reason: 'executive_to_department_manager',
    })
  })

  it('routes department manager-created work to team leads in that department', () => {
    const decision = resolveTaskHierarchyDecision(
      {
        created_by: 'AI Director',
        metadata: { routing_department_external_id: 10 },
      },
      [
        { id: 2, name: 'AI Director', role: 'Department Manager' },
        { id: 4, name: 'Prompt Lead', role: 'Team Lead' },
        { id: 5, name: 'Ops Lead', role: 'Team Lead' },
      ],
      [{ department_external_id: 10, agent_id: 2 }],
      [
        { agent_id: 4, team_external_id: 100, department_external_id: 10, role: 'lead' },
        { agent_id: 5, team_external_id: 110, department_external_id: 10, role: 'lead' },
      ],
    )

    expect(decision).toEqual({
      candidateAgentIds: [4, 5],
      originAgentName: 'AI Director',
      stage: 'team_lead',
      reason: 'department_manager_to_team_lead',
      departmentExternalId: 10,
    })
  })

  it('routes team lead-created work to members on the same team', () => {
    const decision = resolveTaskHierarchyDecision(
      {
        created_by: 'Prompt Lead',
        metadata: { routing_team_external_id: 100 },
      },
      [
        { id: 4, name: 'Prompt Lead', role: 'Team Lead' },
        { id: 6, name: 'Prompt Engineer 1', role: 'Engineer' },
        { id: 7, name: 'Prompt Engineer 2', role: 'Engineer' },
      ],
      [],
      [
        { agent_id: 4, team_external_id: 100, department_external_id: 10, role: 'lead' },
        { agent_id: 6, team_external_id: 100, department_external_id: 10, role: 'member' },
        { agent_id: 7, team_external_id: 100, department_external_id: 10, role: 'member' },
      ],
    )

    expect(decision).toEqual({
      candidateAgentIds: [6, 7],
      originAgentName: 'Prompt Lead',
      stage: 'individual_contributor',
      reason: 'team_lead_to_member',
      departmentExternalId: 10,
      teamExternalId: 100,
    })
  })

  it('falls back from executives to team leads when no department manager exists', () => {
    const decision = resolveTaskHierarchyDecision(
      { created_by: 'CTO' },
      [
        { id: 1, name: 'CTO', role: 'Chief Technology Officer' },
        { id: 8, name: 'Platform Lead', role: 'Team Lead' },
      ],
      [],
      [{ agent_id: 8, team_external_id: 300, department_external_id: 30, role: 'lead' }],
    )

    expect(decision).toEqual({
      candidateAgentIds: [8],
      originAgentName: 'CTO',
      stage: 'team_lead',
      reason: 'executive_fallback_team_lead',
    })
  })
})
