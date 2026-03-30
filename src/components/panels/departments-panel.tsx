'use client'

import { useEffect, useMemo, useState } from 'react'
import { DndContext, DragEndEvent, DragOverlay } from '@dnd-kit/core'
import { useMissionControl } from '@/store'
import type { Department, Agent } from '@/store'
import { EmbeddedChat } from '@/components/chat/embedded-chat'
import { OrgDocsPanel } from '@/components/panels/org-docs-panel'
import { Button } from '@/components/ui/button'
import { useOrgData } from '@/lib/use-org-data'
import { DroppableZone, DraggableCard, StatusDot } from '@/components/ui/dnd-org-helpers'

type DeptTab = 'overview' | 'teams' | 'agents' | 'docs' | 'chat'
type DepartmentFilter = 'all' | 'staffed' | 'empty'

interface DepartmentDetailProps {
  dept: Department
  isReadOnly: boolean
}

function extractAgentId(value: string | number): number {
  const match = String(value).match(/(\d+)$/)
  return match ? Number(match[1]) : NaN
}

function formatShortDate(timestamp?: number): string {
  if (!timestamp) return 'n/a'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(timestamp * 1000)
}

function OverviewMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'accent'
}) {
  return (
    <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
      <div className={`text-xl font-mono tabular-nums ${tone === 'accent' ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground/50">
        {label}
      </div>
    </div>
  )
}

function EmptyState({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
      <span className="text-4xl font-mono mb-3">/</span>
      <span className="text-sm font-mono">{title}</span>
      <span className="text-xs font-mono mt-1 text-muted-foreground/20">{subtitle}</span>
    </div>
  )
}

function DepartmentManagerCard({ agent }: { agent: Agent }) {
  const model = (agent as { model?: string }).model
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <StatusDot status={agent.status} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold font-mono text-foreground truncate">{agent.name}</div>
        <div className="text-[11px] font-mono text-muted-foreground/70 truncate">
          {agent.role || 'Department Manager'} {model ? `/ ${model}` : ''}
        </div>
      </div>
      <div className="text-[10px] font-mono text-muted-foreground/50">
        {agent.status === 'idle' ? 'active' : agent.status}
      </div>
    </div>
  )
}

function DepartmentDetail({ dept, isReadOnly }: DepartmentDetailProps) {
  const [tab, setTab] = useState<DeptTab>('overview')
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDesc, setNewTeamDesc] = useState('')
  const [showHireManagerForm, setShowHireManagerForm] = useState(false)
  const [managerFormData, setManagerFormData] = useState({
    name: '',
    role: 'Department Manager',
    model: '',
  })
  const [isHiringManager, setIsHiringManager] = useState(false)
  const [activeDragAgent, setActiveDragAgent] = useState<Agent | null>(null)

  const teams = useMissionControl((s) => s.teams)
  const agents = useMissionControl((s) => s.agents)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const addTeam = useMissionControl((s) => s.addTeam)
  const assignAgentToTeam = useMissionControl((s) => s.assignAgentToTeam)

  const deptTeams = useMemo(
    () => teams.filter((team) => team.department_id === dept.id),
    [dept.id, teams]
  )

  const deptTeamIds = useMemo(() => new Set(deptTeams.map((team) => team.id)), [deptTeams])
  const deptAssignments = useMemo(
    () => agentTeamAssignments.filter((assignment) => deptTeamIds.has(assignment.team_id)),
    [agentTeamAssignments, deptTeamIds]
  )
  const deptAgentIds = useMemo(
    () => new Set(deptAssignments.map((assignment) => assignment.agent_id)),
    [deptAssignments]
  )
  const deptAgentCount = deptAgentIds.size
  const leadCount = deptAssignments.filter((assignment) => assignment.role === 'lead').length
  const updatedLabel = formatShortDate(dept.updated_at)

  function handleAddTeam(e: React.FormEvent) {
    e.preventDefault()
    if (isReadOnly) return
    if (!newTeamName.trim()) return
    const now = Math.floor(Date.now() / 1000)
    const newId = Math.max(0, ...teams.map((team) => team.id)) + 1
    addTeam({
      id: newId,
      name: newTeamName.trim(),
      description: newTeamDesc.trim(),
      department_id: dept.id,
      color: dept.color,
      created_at: now,
      updated_at: now,
    })
    setNewTeamName('')
    setNewTeamDesc('')
    setShowAddTeam(false)
    setTab('teams')
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isReadOnly) return
    const { active, over } = event
    if (!over) return
    const agentId = extractAgentId(active.id)
    const teamId = parseInt(String(over.id).replace('team-drop-', ''), 10)
    if (!Number.isNaN(agentId) && !Number.isNaN(teamId)) {
      assignAgentToTeam(agentId, teamId, 'member')
    }
  }

  const viewTabs: DeptTab[] = ['overview', 'teams', 'agents', 'docs', 'chat']
  const unassignedAgents = agents.filter((agent) => !agentTeamAssignments.some((assignment) => assignment.agent_id === agent.id))
  const managerAgent = dept.manager_agent_id
    ? agents.find((agent) => agent.id === dept.manager_agent_id) ?? null
    : null

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-[hsl(var(--surface-0))]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dept.color ?? '#888' }} />
          <span className="text-xs font-mono text-foreground truncate">{dept.name}</span>
          <span className="text-[10px] font-mono text-muted-foreground/30 tabular-nums shrink-0">
            {deptTeams.length} teams / {deptAgentCount} agents
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {viewTabs.map((view) => (
            <button
              key={view}
              onClick={() => setTab(view)}
              className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors capitalize ${
                tab === view
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]'
              }`}
            >
              {view}
            </button>
          ))}
        </div>
      </div>

      <div className={tab === 'chat' ? 'flex-1 min-h-0' : 'flex-1 overflow-auto'}>
        {tab === 'overview' && (
          <div className="p-6 max-w-5xl space-y-6">
            <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-5">
              <div className="flex flex-wrap items-start gap-4 justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dept.color ?? '#888' }} />
                    <span className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground/50">
                      Department
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold font-mono text-foreground">{dept.name}</h2>
                  <p className="mt-2 text-sm text-foreground/80 leading-relaxed">
                    {dept.description || 'No department summary has been written yet.'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/40">
                    Updated
                  </div>
                  <div className="mt-1 text-xs font-mono text-muted-foreground/70">{updatedLabel}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <OverviewMetric label="teams" value={deptTeams.length} tone="accent" />
              <OverviewMetric label="agents" value={deptAgentCount} />
              <OverviewMetric label="team leads" value={leadCount} />
            </div>

            <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))]">
              <div className="px-4 py-3 border-b border-border/50">
                <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground/55">
                  department manager
                </div>
              </div>
              {managerAgent ? (
                <DepartmentManagerCard agent={managerAgent} />
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/30">
                  <span className="mb-3 text-4xl font-mono">/</span>
                  <span className="text-sm font-mono">No manager assigned</span>
                  <span className="mt-1 text-xs font-mono text-muted-foreground/20">
                    Hire a manager to oversee this department.
                  </span>
                  <Button variant="default" size="sm" className="mt-3" onClick={() => setShowHireManagerForm(true)}>
                    Hire a Manager
                  </Button>
                </div>
              )}
            </section>

            {showHireManagerForm && (
              <div className="mt-3 border border-border/50 rounded-md bg-[hsl(var(--surface-0))] p-4 space-y-3">
                <div className="text-sm font-mono font-semibold text-foreground">Hire Department Manager</div>
                <input
                  type="text"
                  value={managerFormData.name}
                  onChange={(e) => setManagerFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Manager name"
                  className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground"
                  autoFocus
                />
                <input
                  type="text"
                  value={managerFormData.role}
                  onChange={(e) => setManagerFormData((prev) => ({ ...prev, role: e.target.value }))}
                  placeholder="Role"
                  className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground"
                />
                <input
                  type="text"
                  value={managerFormData.model}
                  onChange={(e) => setManagerFormData((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="Model (e.g. claude-sonnet-4-20250514)"
                  className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground"
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!managerFormData.name.trim() || isHiringManager}
                    onClick={async () => {
                      setIsHiringManager(true)
                      try {
                        const res = await fetch('/api/agents/create', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: managerFormData.name.trim(),
                            role: managerFormData.role,
                            model: managerFormData.model,
                            department_name: dept.name,
                            is_manager: true,
                          }),
                        })
                        if (res.ok) {
                          setShowHireManagerForm(false)
                          setManagerFormData({ name: '', role: 'Department Manager', model: '' })
                          await fetch('/api/org/scan?force=true')
                          window.location.reload()
                        }
                      } finally {
                        setIsHiringManager(false)
                      }
                    }}
                  >
                    Hire
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowHireManagerForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold font-mono text-foreground">Roster</h3>
                  <p className="text-[11px] font-mono text-muted-foreground/50">
                    Live team distribution inside this department.
                  </p>
                </div>
                <button
                  onClick={() => setTab('teams')}
                  className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
                >
                  view teams
                </button>
              </div>
              {deptTeams.length === 0 ? (
                <div className="text-center text-muted-foreground/40 text-xs font-mono py-8">
                  No teams in this department yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {deptTeams.map((team) => {
                    const teamAssignments = agentTeamAssignments.filter((assignment) => assignment.team_id === team.id)
                    const teamLead = teamAssignments.find((assignment) => assignment.role === 'lead')
                    const leadAgent = teamLead ? agents.find((agent) => agent.id === teamLead.agent_id) : null
                    return (
                      <div
                        key={team.id}
                        className="flex items-center gap-3 rounded-md border border-border/40 bg-[hsl(var(--surface-0))] px-3 py-2"
                      >
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color ?? dept.color ?? '#888' }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-mono text-foreground truncate">{team.name}</div>
                          <div className="text-[11px] font-mono text-muted-foreground/50 truncate">
                            {team.description || 'No team description.'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-mono text-muted-foreground/60 tabular-nums">
                            {teamAssignments.length} assigned
                          </div>
                          <div className="text-[10px] font-mono text-primary/70 truncate max-w-36">
                            {leadAgent ? `lead: ${leadAgent.name}` : 'lead: unassigned'}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'teams' && (
          <div className="p-6 max-w-5xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold font-mono text-foreground">Teams</h2>
                <p className="text-xs font-mono text-muted-foreground/50">
                  Department team registry and creation controls.
                </p>
              </div>
              <button
                onClick={() => setShowAddTeam((value) => !value)}
                className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
              >
                {showAddTeam ? 'close form' : 'new team'}
              </button>
            </div>

            {showAddTeam && (
              <form
                onSubmit={handleAddTeam}
                className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 space-y-3"
              >
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground/50">
                  Create Team
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-muted-foreground/60 mb-1">name</label>
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      placeholder="Team name"
                      className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-muted-foreground/60 mb-1">description</label>
                    <input
                      type="text"
                      value={newTeamDesc}
                      onChange={(e) => setNewTeamDesc(e.target.value)}
                      placeholder="Optional description"
                      className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-2 py-1 rounded text-xs font-mono text-primary hover:bg-primary/10 transition-colors"
                  >
                    create
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddTeam(false)}
                    className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
                  >
                    cancel
                  </button>
                </div>
              </form>
            )}

            {deptTeams.length === 0 ? (
              <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-8 text-center text-muted-foreground/40 text-xs font-mono">
                No teams in this department yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {deptTeams.map((team) => {
                  const teamAssignments = agentTeamAssignments.filter((assignment) => assignment.team_id === team.id)
                  const leadAssignment = teamAssignments.find((assignment) => assignment.role === 'lead')
                  const leadAgent = leadAssignment ? agents.find((agent) => agent.id === leadAssignment.agent_id) : null
                  return (
                    <div key={team.id} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
                      <div className="flex items-start gap-3 justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: team.color ?? dept.color ?? '#888' }} />
                            <span className="text-sm font-mono text-foreground truncate">{team.name}</span>
                          </div>
                          <p className="text-[11px] font-mono text-muted-foreground/55 leading-relaxed">
                            {team.description || 'No team description.'}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">
                          {teamAssignments.length} assigned
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-md border border-border/40 bg-[hsl(var(--surface-0))] px-3 py-2">
                          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/40">
                            Lead
                          </div>
                          <div className="mt-1 text-xs font-mono text-foreground truncate">
                            {leadAgent?.name || 'Unassigned'}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/40 bg-[hsl(var(--surface-0))] px-3 py-2">
                          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/40">
                            Updated
                          </div>
                          <div className="mt-1 text-xs font-mono text-foreground truncate">
                            {formatShortDate(team.updated_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'agents' && (
          <DndContext
            onDragStart={(event) => {
              const agentId = extractAgentId(event.active.id)
              const agent = agents.find((item) => item.id === agentId)
              setActiveDragAgent(agent ?? null)
            }}
            onDragEnd={(event) => {
              handleDragEnd(event)
              setActiveDragAgent(null)
            }}
          >
            <div className="p-6 max-w-6xl space-y-4">
              <div>
                <h2 className="text-lg font-semibold font-mono text-foreground">Agents</h2>
                <p className="text-xs font-mono text-muted-foreground/50">
                  Drag agents between the unassigned pool and department teams.
                </p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_18rem] gap-4">
                <div className="space-y-4">
                  {deptTeams.length === 0 ? (
                    <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-8 text-center text-muted-foreground/40 text-xs font-mono">
                      Create a team first to assign agents.
                    </div>
                  ) : (
                    deptTeams.map((team) => {
                      const teamAssignments = agentTeamAssignments.filter((assignment) => assignment.team_id === team.id)
                      const teamAgents = teamAssignments
                        .map((assignment) => ({
                          agent: agents.find((agent) => agent.id === assignment.agent_id),
                          role: assignment.role,
                        }))
                        .filter((value): value is { agent: Agent; role: 'member' | 'lead' } => Boolean(value.agent))

                      return (
                        <div key={team.id} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: team.color ?? dept.color ?? '#888' }} />
                              <h3 className="text-sm font-semibold font-mono text-foreground truncate">{team.name}</h3>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">
                              {teamAgents.length} agents
                            </span>
                          </div>
                          <DroppableZone id={`team-drop-${team.id}`}>
                            {teamAgents.length === 0 ? (
                              <div className="text-center text-muted-foreground/40 text-xs font-mono py-6">
                                No agents assigned. Drag agents here.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {teamAgents.map(({ agent, role }) => (
                                  <DraggableCard key={agent.id} id={`agent-${agent.id}`}>
                                    <div className="flex items-center gap-2 p-2 bg-[hsl(var(--surface-0))] rounded cursor-grab">
                                      <StatusDot status={agent.status} />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-mono text-foreground truncate">{agent.name}</div>
                                        <div className="text-[11px] font-mono text-muted-foreground/50 truncate">{agent.role}</div>
                                      </div>
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${role === 'lead' ? 'bg-primary/10 text-primary' : 'bg-[hsl(var(--surface-2))] text-muted-foreground'}`}>
                                        {role}
                                      </span>
                                    </div>
                                  </DraggableCard>
                                ))}
                              </div>
                            )}
                          </DroppableZone>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 h-fit">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-semibold font-mono text-foreground">Unassigned</h3>
                    <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">
                      {unassignedAgents.length}
                    </span>
                  </div>
                  {unassignedAgents.length === 0 ? (
                    <div className="text-center text-muted-foreground/40 text-xs font-mono py-6">
                      No unassigned agents.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {unassignedAgents.map((agent) => (
                        <DraggableCard key={agent.id} id={`agent-${agent.id}`}>
                          <div className="flex items-center gap-2 p-2 rounded bg-[hsl(var(--surface-0))] cursor-grab">
                            <StatusDot status={agent.status} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-mono text-foreground truncate">{agent.name}</div>
                              <div className="text-[11px] font-mono text-muted-foreground/50 truncate">{agent.role}</div>
                            </div>
                          </div>
                        </DraggableCard>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeDragAgent ? (
                <div className="bg-[hsl(var(--surface-1))] border border-primary/30 rounded-lg p-2 shadow-lg opacity-90 flex items-center gap-2 text-sm">
                  <StatusDot status={activeDragAgent.status} />
                  <span className="font-mono text-foreground">{activeDragAgent.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/60">{activeDragAgent.role}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {tab === 'docs' && (
          <div className="p-6">
            <OrgDocsPanel entityType="department" entityId={dept.id} />
          </div>
        )}

        {tab === 'chat' && (
          <div className="flex h-full min-h-0 flex-1 flex-col">
            {managerAgent ? (
              <EmbeddedChat
                conversationId={`dept:${dept.id}`}
                targetAgentName={managerAgent.name}
                targetAgentStatus={managerAgent.status}
                entityLabel={dept.name}
                entityColor={dept.color}
              />
            ) : (
              <EmptyState
                title="No manager assigned"
                subtitle="Assign a department manager to enable chat"
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}

export function DepartmentsPanel() {
  const { isReadOnly, canCreate } = useOrgData()
  const departments = useMissionControl((s) => s.departments)
  const teams = useMissionControl((s) => s.teams)
  const agents = useMissionControl((s) => s.agents)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)

  const [selectedDept, setSelectedDept] = useState<Department | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showNewDeptForm, setShowNewDeptForm] = useState(false)
  const [newDeptName, setNewDeptName] = useState('')
  const [isCreatingDept, setIsCreatingDept] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState<DepartmentFilter>('all')

  useEffect(() => {
    if (!selectedDept && departments.length > 0) {
      setSelectedDept(departments[0])
    }
  }, [departments, selectedDept])

  const filteredDepartments = useMemo(() => {
    return departments.filter((department) => {
      const teamCount = teams.filter((team) => team.department_id === department.id).length
      const matchesQuery = department.name.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesFilter =
        deptFilter === 'all' ? true : deptFilter === 'staffed' ? teamCount > 0 : teamCount === 0
      return matchesQuery && matchesFilter
    })
  }, [departments, teams, searchQuery, deptFilter])

  const totalTeamCount = teams.length
  const staffedDepartmentCount = departments.filter((department) =>
    teams.some((team) => team.department_id === department.id)
  ).length
  const totalAssignedAgents = new Set(agentTeamAssignments.map((assignment) => assignment.agent_id)).size

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]">
        <button
          onClick={() => setSidebarOpen((value) => !value)}
          className="p-1.5 rounded hover:bg-[hsl(var(--surface-2))] text-muted-foreground text-xs font-mono"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          |||
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <span className="px-2.5 py-1 rounded text-xs font-mono bg-[hsl(var(--surface-2))] text-foreground">
          departments
        </span>
        <div className="flex-1" />
        <span className="text-[10px] font-mono text-muted-foreground/50 tabular-nums">
          {departments.length} depts / {totalTeamCount} teams / {totalAssignedAgents} assigned
        </span>
        <div className="w-px h-4 bg-border mx-1" />
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            setShowNewDeptForm(true)
            setSelectedDept(null)
          }}
          disabled={!canCreate}
        >
          New Department
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <div className="w-60 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0">
            <div className="p-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search departments"
                className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
            </div>
            <div className="flex gap-0.5 px-2 pb-2">
              {(['all', 'staffed', 'empty'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setDeptFilter(filter)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                    deptFilter === filter
                      ? 'bg-[hsl(var(--surface-2))] text-foreground'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
            <div className="px-2 pb-2 border-b border-border/50">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-border/40 bg-[hsl(var(--surface-1))] px-2 py-1.5">
                  <div className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-[0.14em]">
                    staffed
                  </div>
                  <div className="text-xs font-mono text-foreground tabular-nums">{staffedDepartmentCount}</div>
                </div>
                <div className="rounded border border-border/40 bg-[hsl(var(--surface-1))] px-2 py-1.5">
                  <div className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-[0.14em]">
                    agents
                  </div>
                  <div className="text-xs font-mono text-foreground tabular-nums">{agents.length}</div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {filteredDepartments.length === 0 ? (
                <div className="text-center text-muted-foreground/40 text-xs font-mono py-8">
                  No departments found.
                </div>
              ) : (
                filteredDepartments.map((department) => {
                  const departmentTeams = teams.filter((team) => team.department_id === department.id)
                  const departmentAgentIds = new Set(
                    agentTeamAssignments
                      .filter((assignment) => departmentTeams.some((team) => team.id === assignment.team_id))
                      .map((assignment) => assignment.agent_id)
                  )
                  const selected = selectedDept?.id === department.id
                  return (
                    <button
                      key={department.id}
                      onClick={() => {
                        setSelectedDept(department)
                      }}
                      className={`w-full text-left px-2 py-1.5 transition-colors ${
                        selected ? 'bg-[hsl(var(--surface-2))]' : 'hover:bg-[hsl(var(--surface-2))]'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="inline-block w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: department.color ?? '#888' }} />
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-mono truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {department.name}
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground/35 truncate">
                            {department.description || 'No description'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">
                            {departmentTeams.length}t
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground/30 tabular-nums">
                            {departmentAgentIds.size}a
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col bg-[hsl(var(--surface-0))]">
          {showNewDeptForm && (
            <div className="px-4 py-3 border-b border-border/50 bg-[hsl(var(--surface-1))] space-y-2">
              <div className="text-sm font-mono font-semibold text-foreground">Create New Department</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="Department name"
                  className="flex-1 px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
                  autoFocus
                />
                <Button
                  variant="default"
                  size="sm"
                  disabled={!newDeptName.trim() || isCreatingDept}
                  onClick={async () => {
                    setIsCreatingDept(true)
                    try {
                      const res = await fetch('/api/departments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newDeptName.trim() }),
                      })
                      if (res.ok) {
                        setShowNewDeptForm(false)
                        setNewDeptName('')
                        await fetch('/api/org/scan?force=true')
                        window.location.reload()
                      }
                    } finally {
                      setIsCreatingDept(false)
                    }
                  }}
                >
                  Create
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowNewDeptForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {selectedDept ? (
            <DepartmentDetail dept={selectedDept} isReadOnly={isReadOnly} />
          ) : (
            <EmptyState
              title="Select a department"
              subtitle="Use the sidebar or create a new department."
            />
          )}
        </div>
      </div>
    </div>
  )
}
