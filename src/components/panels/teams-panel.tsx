'use client'

import { useEffect, useMemo, useState } from 'react'
import { DndContext, DragEndEvent, DragOverlay } from '@dnd-kit/core'
import { useMissionControl } from '@/store'
import type { Agent, Team } from '@/store'
import { EmbeddedChat } from '@/components/chat/embedded-chat'
import { AgentMultiSelect } from '@/components/ui/agent-multi-select'
import { OrgDocsPanel } from '@/components/panels/org-docs-panel'
import { useOrgData } from '@/lib/use-org-data'
import { DraggableCard, DroppableZone, StatusDot } from '@/components/ui/dnd-org-helpers'

type TeamView = 'overview' | 'members' | 'docs' | 'chat'

interface TeamDetailProps {
  team: Team
  view: TeamView
  isReadOnly: boolean
}

function TeamDetail({ team, view, isReadOnly }: TeamDetailProps) {
  const [showAddMember, setShowAddMember] = useState(false)
  const [activeDragAgent, setActiveDragAgent] = useState<Agent | null>(null)

  const departments = useMissionControl((s) => s.departments)
  const agents = useMissionControl((s) => s.agents)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const assignAgentToTeam = useMissionControl((s) => s.assignAgentToTeam)
  const removeAgentFromTeam = useMissionControl((s) => s.removeAgentFromTeam)

  const dept = departments.find((d) => d.id === team.department_id)
  const teamAssignments = agentTeamAssignments.filter((assignment) => assignment.team_id === team.id)
  const members = teamAssignments
    .map((assignment) => ({
      agent: agents.find((agent) => agent.id === assignment.agent_id),
      role: assignment.role,
    }))
    .filter((entry): entry is { agent: Agent; role: 'member' | 'lead' } => Boolean(entry.agent))

  const lead = members.find((member) => member.role === 'lead')
  const activeCount = members.filter(({ agent }) => agent.status !== 'offline').length
  const busyCount = members.filter(({ agent }) => agent.status === 'busy').length

  function handleAddMembers(agentIds: number[]) {
    if (isReadOnly) return
    agentIds.forEach((agentId) => assignAgentToTeam(agentId, team.id, 'member'))
    setShowAddMember(false)
  }

  function handleSetLead(agentId: number) {
    if (isReadOnly) return
    const existingLead = teamAssignments.find((assignment) => assignment.role === 'lead')
    if (existingLead && existingLead.agent_id !== agentId) {
      assignAgentToTeam(existingLead.agent_id, team.id, 'member')
    }
    assignAgentToTeam(agentId, team.id, 'lead')
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isReadOnly) return
    const { active, over } = event
    if (!over) return
    const agentId = Number.parseInt(String(active.id).replace('member-', ''), 10)
    if (!Number.isNaN(agentId)) {
      assignAgentToTeam(agentId, team.id, 'member')
    }
  }

  const statCards = [
    { label: 'members', value: String(members.length).padStart(2, '0') },
    { label: 'active', value: String(activeCount).padStart(2, '0') },
    { label: 'busy', value: String(busyCount).padStart(2, '0') },
  ]

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-[hsl(var(--surface-0))]">
        <span className="text-xs font-mono text-muted-foreground/60 truncate flex-1">
          teams/{dept?.name.toLowerCase().replace(/\s+/g, '-') ?? 'unassigned'}/{team.name.toLowerCase().replace(/\s+/g, '-')}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/30 tabular-nums shrink-0">
          {members.length} members
        </span>
      </div>

      {view === 'docs' ? (
        <div className="flex-1 min-h-0">
          <OrgDocsPanel entityType="team" entityId={team.id} />
        </div>
      ) : view === 'chat' ? (
        <div className="flex-1 min-h-0">
          {lead?.agent ? (
            <EmbeddedChat
              conversationId={`team:${team.id}`}
              targetAgentName={lead.agent.name}
              targetAgentStatus={lead.agent.status}
              entityLabel={team.name}
              entityColor={team.color ?? dept?.color}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground/30">
              <span className="mb-3 text-4xl font-mono">/</span>
              <span className="text-sm font-mono">No team lead assigned</span>
              <span className="mt-1 text-xs font-mono text-muted-foreground/20">
                Promote an agent to lead to enable chat
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="space-y-4">
            <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))]">
              <div className="flex items-start gap-3 px-4 py-4 border-b border-border/50">
                <div
                  className="mt-0.5 h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: team.color ?? dept?.color ?? '#888' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-semibold text-foreground font-mono">{team.name}</h2>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-[hsl(var(--surface-2))] text-muted-foreground">
                      {dept?.name ?? 'Unknown Department'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground font-mono leading-relaxed">
                    {team.description || 'No team description configured.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-px bg-border/50 md:grid-cols-4">
                {statCards.map((card) => (
                  <div key={card.label} className="bg-[hsl(var(--surface-0))] px-4 py-3">
                    <div className="text-lg font-semibold text-foreground font-mono tabular-nums">
                      {card.value}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/55">
                      {card.label}
                    </div>
                  </div>
                ))}
                <div className="bg-[hsl(var(--surface-0))] px-4 py-3">
                  <div className="text-sm font-semibold text-foreground font-mono truncate">
                    {lead?.agent.name ?? 'Unassigned'}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/55">
                    team lead
                  </div>
                </div>
              </div>
            </section>

            {view === 'overview' ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
                <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))]">
                  <div className="px-4 py-3 border-b border-border/50">
                    <div className="text-sm font-semibold font-mono text-foreground">team roster</div>
                    <div className="text-[11px] font-mono text-muted-foreground/55">
                      Current assignments and workload visibility.
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {members.length === 0 ? (
                      <div className="text-center text-muted-foreground/40 text-xs font-mono py-10">
                        no members assigned
                      </div>
                    ) : (
                      members.map(({ agent, role }) => (
                        <div
                          key={agent.id}
                          className="flex items-center gap-3 rounded-md border border-border/50 bg-[hsl(var(--surface-0))] px-3 py-2"
                        >
                          <StatusDot status={agent.status} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-mono text-foreground truncate">{agent.name}</div>
                            <div className="text-[11px] font-mono text-muted-foreground/55 truncate">
                              {agent.role}
                            </div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${
                              role === 'lead'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-[hsl(var(--surface-2))] text-muted-foreground'
                            }`}
                          >
                            {role}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))]">
                  <div className="px-4 py-3 border-b border-border/50">
                    <div className="text-sm font-semibold font-mono text-foreground">team notes</div>
                    <div className="text-[11px] font-mono text-muted-foreground/55">
                      Quick operational context for this workspace.
                    </div>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/45 mb-2">
                        department
                      </div>
                      <div className="flex items-center gap-2 text-sm font-mono text-foreground">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: dept?.color ?? '#888' }}
                        />
                        <span>{dept?.name ?? 'Unknown Department'}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/45 mb-2">
                        staffing
                      </div>
                      <div className="space-y-1 text-[11px] font-mono text-muted-foreground/70">
                        <div>{members.length} assigned agents</div>
                        <div>{activeCount} agents currently reachable</div>
                        <div>{busyCount} agents marked busy</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/45 mb-2">
                        lead
                      </div>
                      <div className="text-sm font-mono text-foreground">
                        {lead?.agent.name ?? 'No lead assigned'}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))] min-h-[24rem] flex flex-col">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
                  <div>
                    <div className="text-sm font-semibold font-mono text-foreground">members</div>
                    <div className="text-[11px] font-mono text-muted-foreground/55">
                      Drag, promote, and remove team assignments.
                    </div>
                  </div>
                  <div className="flex-1" />
                  <div className="relative">
                    <button
                      onClick={() => setShowAddMember((value) => !value)}
                      className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
                    >
                      add member
                    </button>
                    {showAddMember && (
                      <AgentMultiSelect
                        teamId={team.id}
                        onAdd={handleAddMembers}
                        onClose={() => setShowAddMember(false)}
                      />
                    )}
                  </div>
                </div>

                <div className="flex-1 p-4">
                  <DndContext
                    onDragStart={(event) => {
                      const agentId = Number(event.active.id.toString().replace('member-', ''))
                      const agent = agents.find((entry) => entry.id === agentId)
                      setActiveDragAgent(agent ?? null)
                    }}
                    onDragEnd={(event) => {
                      handleDragEnd(event)
                      setActiveDragAgent(null)
                    }}
                  >
                    <DroppableZone id={`team-members-${team.id}`}>
                      {members.length === 0 ? (
                        <div className="text-center text-muted-foreground/40 text-xs font-mono py-12">
                          no members assigned
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {members.map(({ agent, role }) => (
                            <DraggableCard key={agent.id} id={`member-${agent.id}`}>
                              <div className="flex items-center gap-3 p-3 bg-[hsl(var(--surface-0))] border border-border/50 rounded-md cursor-grab">
                                <StatusDot status={agent.status} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-foreground truncate font-mono">{agent.name}</div>
                                  <div className="text-[11px] text-muted-foreground/55 truncate font-mono">
                                    {agent.role}
                                  </div>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${
                                    role === 'lead'
                                      ? 'bg-primary/10 text-primary'
                                      : 'bg-[hsl(var(--surface-2))] text-muted-foreground'
                                  }`}
                                >
                                  {role}
                                </span>
                                {role !== 'lead' && (
                                  <button
                                    onClick={() => handleSetLead(agent.id)}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    className="px-2 py-1 rounded text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
                                    title="Set as lead"
                                  >
                                    promote
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    if (isReadOnly) return
                                    removeAgentFromTeam(agent.id, team.id)
                                  }}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  className="px-2 py-1 rounded text-[11px] font-mono text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  title="Remove from team"
                                >
                                  remove
                                </button>
                              </div>
                            </DraggableCard>
                          ))}
                        </div>
                      )}
                    </DroppableZone>
                    <DragOverlay>
                      {activeDragAgent ? (
                        <div className="bg-[hsl(var(--surface-0))] border border-primary/40 rounded-md px-3 py-2 shadow-lg opacity-90 flex items-center gap-2 text-sm">
                          <StatusDot status={activeDragAgent.status} />
                          <span className="font-medium font-mono text-foreground">{activeDragAgent.name}</span>
                          <span className="text-[11px] text-muted-foreground/55 font-mono">
                            {activeDragAgent.role}
                          </span>
                        </div>
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function TeamsPanel() {
  const { isReadOnly } = useOrgData()
  const departments = useMissionControl((s) => s.departments)
  const teams = useMissionControl((s) => s.teams)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [deptFilter, setDeptFilter] = useState<number | null>(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [activeView, setActiveView] = useState<TeamView>('overview')
  const [showNewTeamHint, setShowNewTeamHint] = useState(false)

  const filteredTeams = useMemo(() => {
    const query = teamSearch.trim().toLowerCase()
    return teams.filter((team) => {
      if (deptFilter !== null && team.department_id !== deptFilter) return false
      if (!query) return true
      const deptName = departments.find((dept) => dept.id === team.department_id)?.name ?? ''
      return `${team.name} ${team.description ?? ''} ${deptName}`.toLowerCase().includes(query)
    })
  }, [departments, deptFilter, teamSearch, teams])

  useEffect(() => {
    if (filteredTeams.length === 0) {
      setSelectedTeamId(null)
      return
    }
    if (!filteredTeams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(filteredTeams[0].id)
    }
  }, [filteredTeams, selectedTeamId])

  const selectedTeam = filteredTeams.find((team) => team.id === selectedTeamId) ?? null
  const totalAssignments = agentTeamAssignments.length

  const memberCount = (teamId: number) =>
    agentTeamAssignments.filter((assignment) => assignment.team_id === teamId).length

  const deptForTeam = (deptId: number) => departments.find((dept) => dept.id === deptId)

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-[hsl(var(--surface-2))] text-muted-foreground text-xs font-mono"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          |||
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        {(['overview', 'members', 'docs', 'chat'] as const).map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors capitalize ${
              activeView === view
                ? 'bg-[hsl(var(--surface-2))] text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {view}
          </button>
        ))}
        <div className="flex-1" />
        {selectedTeam && (
          <span className="text-[10px] font-mono text-primary/70 truncate max-w-48">
            {selectedTeam.name}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">
          {filteredTeams.length} teams / {totalAssignments} assignments
        </span>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={() => {
            if (isReadOnly) return
            setShowNewTeamHint(true)
            setSelectedTeamId(null)
          }}
          className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
        >
          new team
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <div className="w-60 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0">
            <div className="p-2">
              <input
                type="text"
                value={teamSearch}
                onChange={(event) => setTeamSearch(event.target.value)}
                placeholder="search teams..."
                className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
            </div>
            <div className="px-2 pb-2">
              <select
                value={deptFilter ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setDeptFilter(value === '' ? null : Number.parseInt(value, 10))
                  setShowNewTeamHint(false)
                }}
                className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
              >
                <option value="">all departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="px-2 pb-2 text-[10px] text-muted-foreground/50 font-mono">
              {filteredTeams.length} visible
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {filteredTeams.length === 0 ? (
                <div className="text-center text-muted-foreground/40 text-xs font-mono py-8">
                  no teams
                </div>
              ) : (
                filteredTeams.map((team) => {
                  const department = deptForTeam(team.department_id)
                  const isSelected = team.id === selectedTeamId

                  return (
                    <button
                      key={team.id}
                      onClick={() => {
                        setSelectedTeamId(team.id)
                        setShowNewTeamHint(false)
                      }}
                      className={`w-full text-left px-2 py-1.5 transition-colors ${
                        isSelected
                          ? 'bg-[hsl(var(--surface-2))] text-foreground'
                          : 'text-muted-foreground hover:bg-[hsl(var(--surface-2))]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: team.color ?? department?.color ?? '#888' }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-mono">{team.name}</div>
                          <div className="truncate text-[10px] font-mono text-muted-foreground/55">
                            {department?.name ?? 'Unknown Department'}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground/45 tabular-nums shrink-0">
                          {memberCount(team.id)}
                        </span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
            <div className="p-2 border-t border-border/50">
              <button
                onClick={() => {
                  setTeamSearch('')
                  setDeptFilter(null)
                }}
                className="w-full py-1 text-[11px] font-mono text-muted-foreground/50 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-1))] transition-colors"
              >
                reset filters
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col bg-[hsl(var(--surface-0))]">
          {showNewTeamHint && !selectedTeam ? (
            <div className="px-4 py-3 border-b border-border/50 bg-[hsl(var(--surface-1))] text-xs font-mono text-muted-foreground/70">
              create teams from the departments panel
            </div>
          ) : null}

          {selectedTeam ? (
            <TeamDetail key={`${selectedTeam.id}-${activeView}`} team={selectedTeam} view={activeView} isReadOnly={isReadOnly} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl font-mono mb-3 text-muted-foreground/20">/</div>
                <div className="text-sm font-mono text-muted-foreground">select a team</div>
                <div className="text-xs font-mono mt-1 text-muted-foreground/20">
                  or switch filters in the sidebar
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
