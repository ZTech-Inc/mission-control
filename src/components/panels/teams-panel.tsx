'use client'

import { useState, useEffect } from 'react'
import { DndContext, DragEndEvent, DragOverlay } from '@dnd-kit/core'
import { useMissionControl } from '@/store'
import type { Team, Agent } from '@/store'
import { EntityListSidebar } from '@/components/ui/entity-list-sidebar'
import { AgentMultiSelect } from '@/components/ui/agent-multi-select'
import { OrgDocsPanel } from '@/components/panels/org-docs-panel'
import { MOCK_DEPARTMENTS, MOCK_TEAMS, MOCK_AGENT_ASSIGNMENTS } from '@/lib/mock-org-data'
import { DroppableZone, DraggableCard, StatusDot } from '@/components/ui/dnd-org-helpers'

// --- Team Detail ---

type TeamTab = 'overview' | 'members' | 'docs'

interface TeamDetailProps {
  team: Team
}

function TeamDetail({ team }: TeamDetailProps) {
  const [tab, setTab] = useState<TeamTab>('overview')
  const [showAddMember, setShowAddMember] = useState(false)
  const [activeDragAgent, setActiveDragAgent] = useState<Agent | null>(null)

  const departments = useMissionControl((s) => s.departments)
  const agents = useMissionControl((s) => s.agents)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const assignAgentToTeam = useMissionControl((s) => s.assignAgentToTeam)
  const removeAgentFromTeam = useMissionControl((s) => s.removeAgentFromTeam)

  const dept = departments.find((d) => d.id === team.department_id)
  const teamAssignments = agentTeamAssignments.filter((a) => a.team_id === team.id)
  const members = teamAssignments
    .map((a) => ({
      agent: agents.find((ag) => ag.id === a.agent_id),
      role: a.role,
    }))
    .filter((x): x is { agent: Agent; role: 'member' | 'lead' } => !!x.agent)

  const lead = members.find((m) => m.role === 'lead')

  function handleAddMembers(agentIds: number[]) {
    agentIds.forEach((id) => assignAgentToTeam(id, team.id, 'member'))
  }

  function handleSetLead(agentId: number) {
    // Demote existing lead to member
    const existingLead = teamAssignments.find((a) => a.role === 'lead')
    if (existingLead && existingLead.agent_id !== agentId) {
      assignAgentToTeam(existingLead.agent_id, team.id, 'member')
    }
    assignAgentToTeam(agentId, team.id, 'lead')
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const agentId = parseInt(String(active.id).replace('member-', ''), 10)
    if (!isNaN(agentId)) {
      // Reorder / keep in team — just re-assign as member
      assignAgentToTeam(agentId, team.id, 'member')
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: team.color ?? '#888' }}
        />
        <h2 className="text-xl font-semibold text-foreground">{team.name}</h2>
      </div>
      {team.description && (
        <p className="text-sm text-muted-foreground mb-4">{team.description}</p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4">
        {(['overview', 'members', 'docs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm capitalize transition-colors ${
              tab === t
                ? 'text-foreground border-b-2 border-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-2xl font-bold text-foreground">{members.length}</div>
              <div className="text-sm text-muted-foreground">Members</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-sm font-medium text-foreground">
                {lead ? lead.agent.name : 'None'}
              </div>
              <div className="text-sm text-muted-foreground">Team Lead</div>
            </div>
          </div>
          {dept && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Department:</span>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: dept.color ?? '#888' }}
                />
                <span className="text-foreground">{dept.name}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Members */}
      {tab === 'members' && (
        <div>
          <div className="flex justify-end mb-3 relative">
            <button
              onClick={() => setShowAddMember((v) => !v)}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-1 text-foreground transition-colors"
            >
              + Add Member
            </button>
            {showAddMember && (
              <AgentMultiSelect
                teamId={team.id}
                onAdd={handleAddMembers}
                onClose={() => setShowAddMember(false)}
              />
            )}
          </div>

          <DndContext
            onDragStart={(event) => {
              const agentId = Number(event.active.id.toString().replace('member-', ''))
              const agent = agents.find(a => a.id === agentId)
              setActiveDragAgent(agent ?? null)
            }}
            onDragEnd={(event) => {
              handleDragEnd(event)
              setActiveDragAgent(null)
            }}
          >
            <DroppableZone id={`team-members-${team.id}`}>
              {members.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2 text-center">
                  No members yet — add agents above
                </div>
              ) : (
                <div className="space-y-2">
                  {members.map(({ agent, role }) => (
                    <DraggableCard key={agent.id} id={`member-${agent.id}`}>
                      <div className="flex items-center gap-2 p-2 bg-[hsl(var(--surface-0))] rounded cursor-grab">
                        <StatusDot status={agent.status} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground truncate">{agent.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{agent.role}</div>
                        </div>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            role === 'lead'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-surface-1 text-muted-foreground'
                          }`}
                        >
                          {role}
                        </span>
                        {role !== 'lead' && (
                          <button
                            onClick={() => handleSetLead(agent.id)}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
                            title="Set as lead"
                          >
                            ★
                          </button>
                        )}
                        <button
                          onClick={() => removeAgentFromTeam(agent.id, team.id)}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="text-xs text-muted-foreground hover:text-red-500 transition-colors px-1"
                          title="Remove from team"
                        >
                          ✕
                        </button>
                      </div>
                    </DraggableCard>
                  ))}
                </div>
              )}
            </DroppableZone>
            <DragOverlay>
              {activeDragAgent ? (
                <div className="bg-card border border-primary/50 rounded-lg p-2 shadow-lg opacity-90 flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${
                    activeDragAgent.status === 'idle' ? 'bg-green-500'
                    : activeDragAgent.status === 'busy' ? 'bg-yellow-500'
                    : activeDragAgent.status === 'error' ? 'bg-red-500'
                    : 'bg-gray-500'
                  }`} />
                  <span className="font-medium">{activeDragAgent.name}</span>
                  <span className="text-xs text-muted-foreground">{activeDragAgent.role}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* Docs */}
      {tab === 'docs' && <OrgDocsPanel entityType="team" entityId={team.id} />}
    </div>
  )
}

// --- Main Panel ---

export function TeamsPanel() {
  const departments = useMissionControl((s) => s.departments)
  const teams = useMissionControl((s) => s.teams)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const setDepartments = useMissionControl((s) => s.setDepartments)
  const setTeams = useMissionControl((s) => s.setTeams)
  const setAgentTeamAssignments = useMissionControl((s) => s.setAgentTeamAssignments)

  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [deptFilter, setDeptFilter] = useState<number | null>(null)
  const [showNewTeamHint, setShowNewTeamHint] = useState(false)

  useEffect(() => {
    if (departments.length === 0) setDepartments(MOCK_DEPARTMENTS)
    if (teams.length === 0) setTeams(MOCK_TEAMS)
    if (agentTeamAssignments.length === 0) setAgentTeamAssignments(MOCK_AGENT_ASSIGNMENTS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredTeams =
    deptFilter !== null ? teams.filter((t) => t.department_id === deptFilter) : teams

  // Auto-select first team
  useEffect(() => {
    if (!selectedTeam && filteredTeams.length > 0) {
      setSelectedTeam(filteredTeams[0])
    }
  }, [filteredTeams, selectedTeam])

  const memberCount = (teamId: number) =>
    agentTeamAssignments.filter((a) => a.team_id === teamId).length

  const deptName = (deptId: number) =>
    departments.find((d) => d.id === deptId)?.name ?? 'Unknown'

  const deptColor = (deptId: number) =>
    departments.find((d) => d.id === deptId)?.color ?? '#888'

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <EntityListSidebar
        items={filteredTeams}
        selectedId={selectedTeam?.id ?? null}
        onSelect={(team) => setSelectedTeam(team)}
        renderItem={(team, _isSelected) => (
          <div className="flex items-center gap-2 px-3 py-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: team.color ?? deptColor(team.department_id) }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate text-foreground">{team.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {deptName(team.department_id)}
              </div>
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {memberCount(team.id)}
            </span>
          </div>
        )}
        createLabel="New Team"
        onCreate={() => {
          setShowNewTeamHint(true)
          setSelectedTeam(null)
        }}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        filterComponent={
          <select
            value={deptFilter ?? ''}
            onChange={(e) => {
              const val = e.target.value
              setDeptFilter(val === '' ? null : parseInt(val, 10))
              setSelectedTeam(null)
            }}
            className="w-full px-2 py-1.5 text-xs bg-[hsl(var(--surface-0))] border border-border rounded text-foreground focus:outline-none focus:border-primary"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        }
      />

      {/* Detail Pane */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {showNewTeamHint && (
          <div className="text-xs text-muted-foreground p-3 border-b border-border bg-[hsl(var(--surface-1))]">
            Create teams from the Departments panel
          </div>
        )}
        <div className="p-6">
          {selectedTeam ? (
            <TeamDetail team={selectedTeam} />
          ) : (
            <div className="text-muted-foreground text-sm">
              Select a team from the sidebar
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
