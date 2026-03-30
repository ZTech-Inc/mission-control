'use client'

import { useEffect, useMemo, useState } from 'react'
import { DndContext, DragEndEvent, DragOverlay } from '@dnd-kit/core'
import { useMissionControl } from '@/store'
import type { Agent, Team } from '@/store'
import { EmbeddedChat } from '@/components/chat/embedded-chat'
import {
  ActivityTab,
  ChannelsTab,
  ConfigTab,
  CronTab,
  FilesTab,
  MemoryTab,
  ModelsTab,
  OverviewTab,
  SoulTab,
  TasksTab,
  ToolsTab,
} from '@/components/panels/agent-detail-tabs'
import { Button } from '@/components/ui/button'
import { OrgDocsPanel } from '@/components/panels/org-docs-panel'
import { useOrgData } from '@/lib/use-org-data'
import { DraggableCard, DroppableZone, StatusDot } from '@/components/ui/dnd-org-helpers'

type TeamView = 'overview' | 'members' | 'docs' | 'chat'

interface TeamDetailProps {
  team: Team
  view: TeamView
  isReadOnly: boolean
}

const DETAIL_TABS = [
  'Overview',
  'Files',
  'Tools',
  'Models',
  'Channels',
  'Cron',
  'SOUL',
  'Memory',
  'Tasks',
  'Activity',
  'Config',
] as const

type DetailTabName = typeof DETAIL_TABS[number]

function DetailTabContent({ agent, tab }: { agent: Agent; tab: DetailTabName }) {
  const noopAsync = async () => {}

  switch (tab) {
    case 'Overview':
      return (
        <OverviewTab
          agent={agent}
          editing={false}
          formData={{}}
          setFormData={() => {}}
          onSave={noopAsync}
          onStatusUpdate={noopAsync}
          onWakeAgent={noopAsync}
          onEdit={() => {}}
          onCancel={() => {}}
          heartbeatData={null}
          loadingHeartbeat={false}
          onPerformHeartbeat={noopAsync}
        />
      )
    case 'Files':
      return <FilesTab agent={agent} />
    case 'Tools':
      return <ToolsTab agent={agent} />
    case 'Models':
      return <ModelsTab agent={agent} />
    case 'Channels':
      return <ChannelsTab agent={agent} />
    case 'Cron':
      return <CronTab agent={agent} />
    case 'SOUL':
      return <SoulTab agent={agent} soulContent={agent.soul_content ?? ''} templates={[]} onSave={noopAsync} />
    case 'Memory':
      return <MemoryTab agent={agent} workingMemory={agent.working_memory ?? ''} onSave={noopAsync} />
    case 'Tasks':
      return <TasksTab agent={agent} />
    case 'Activity':
      return <ActivityTab agent={agent} />
    case 'Config':
      return <ConfigTab agent={agent} onSave={() => {}} />
    default:
      return null
  }
}

function InlineAgentDetailsCard({
  agent,
  activeTab,
  onTabChange,
}: {
  agent: Agent
  activeTab: DetailTabName
  onTabChange: (tab: DetailTabName) => void
}) {
  return (
    <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))] flex min-h-[28rem]">
      <div className="w-32 shrink-0 border-r border-border/50 flex flex-col py-2" role="tablist" aria-orientation="vertical">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab}
            id={`tab-${tab}`}
            onClick={() => onTabChange(tab)}
            role="tab"
            aria-selected={activeTab === tab}
            className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors ${
              activeTab === tab
                ? 'bg-[hsl(var(--surface-2))] text-foreground'
                : 'text-muted-foreground hover:bg-[hsl(var(--surface-2))] hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        <DetailTabContent agent={agent} tab={activeTab} />
      </div>
    </section>
  )
}

function CreateTeamAgentForm({
  departmentName,
  teamName,
  onClose,
  onCreated,
}: {
  departmentName: string
  teamName: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [model, setModel] = useState('')
  const [identityMd, setIdentityMd] = useState('')
  const [agentMd, setAgentMd] = useState('')
  const [soulMd, setSoulMd] = useState('')
  const [toolAllow, setToolAllow] = useState('')
  const [toolDeny, setToolDeny] = useState('')
  const [toolProfile, setToolProfile] = useState('')
  const [modelPrimary, setModelPrimary] = useState('')
  const [modelFallback, setModelFallback] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim() || !departmentName || !teamName) return
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim() || undefined,
          model: model.trim() || undefined,
          identity_md: identityMd || undefined,
          agent_md: agentMd || undefined,
          soul_md: soulMd || undefined,
          department_name: departmentName, team_name: teamName,
          tool_allow: toolAllow ? toolAllow.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          tool_deny: toolDeny ? toolDeny.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          tool_profile: toolProfile.trim() || undefined,
          model_primary: modelPrimary.trim() || undefined,
          model_fallback: modelFallback
            ? modelFallback.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined,
        }),
      })
      if (res.ok) {
        onCreated()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-4 border-b border-border/50 bg-[hsl(var(--surface-1))] space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-mono font-semibold text-foreground">Create New Agent</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agent name *"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
          autoFocus
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
        />
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
        />
      </div>
      <div className="space-y-2">
        <textarea
          value={identityMd}
          onChange={(e) => setIdentityMd(e.target.value)}
          placeholder="IDENTITY.md content"
          rows={3}
          className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 resize-y"
        />
        <textarea
          value={agentMd}
          onChange={(e) => setAgentMd(e.target.value)}
          placeholder="AGENT.md content"
          rows={3}
          className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 resize-y"
        />
        <textarea
          value={soulMd}
          onChange={(e) => setSoulMd(e.target.value)}
          placeholder="SOUL.md content"
          rows={3}
          className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 resize-y"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={toolAllow}
          onChange={(e) => setToolAllow(e.target.value)}
          placeholder="Tool allow list (comma-separated)"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
        />
        <input
          value={toolDeny}
          onChange={(e) => setToolDeny(e.target.value)}
          placeholder="Tool deny list (comma-separated)"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input
          value={toolProfile}
          onChange={(e) => setToolProfile(e.target.value)}
          placeholder="Tool profile"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
        />
        <input
          value={modelPrimary}
          onChange={(e) => setModelPrimary(e.target.value)}
          placeholder="Primary model"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
        />
        <input
          value={modelFallback}
          onChange={(e) => setModelFallback(e.target.value)}
          placeholder="Fallback models (comma-separated)"
          className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40"
        />
      </div>
      <Button variant="default" size="sm" disabled={!name.trim() || isSubmitting} onClick={handleSubmit}>
        Create Agent
      </Button>
    </div>
  )
}

function TeamDetail({ team, view, isReadOnly }: TeamDetailProps) {
  const [showCreateAgentForm, setShowCreateAgentForm] = useState(false)
  const [confirmingPromote, setConfirmingPromote] = useState<number | null>(null)
  const [activeDragAgent, setActiveDragAgent] = useState<Agent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTabName>('Overview')

  const departments = useMissionControl((s) => s.departments)
  const agents = useMissionControl((s) => s.agents)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const assignAgentToTeam = useMissionControl((s) => s.assignAgentToTeam)
  const promoteToLead = useMissionControl((s) => s.promoteToLead)
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
  const selectedAgent = selectedAgentId !== null
    ? members.find((member) => member.agent.id === selectedAgentId)?.agent ?? null
    : null

  useEffect(() => {
    const leadMember = members.find((member) => member.role === 'lead')
    setSelectedAgentId(leadMember ? leadMember.agent.id : null)
    setDetailTab('Overview')
  }, [team.id])

  async function handleSetLead(agentId: number) {
    await promoteToLead(agentId, team.id)
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
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(200px,1fr)_minmax(0,2fr)]">
                <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))]">
                  <div className="px-4 py-3 border-b border-border/50">
                    <div className="text-sm font-semibold font-mono text-foreground">team roster</div>
                    <div className="text-[11px] font-mono text-muted-foreground/55">
                      Click an agent to view details.
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {members.length === 0 ? (
                      <div className="text-center text-muted-foreground/40 text-xs font-mono py-10">
                        No members
                        <div className="mt-1 text-[10px]">Add agents to this team to get started.</div>
                      </div>
                    ) : (
                      members.map(({ agent, role }) => (
                        <button
                          key={agent.id}
                          onClick={() => setSelectedAgentId(agent.id)}
                          className={`w-full flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                            selectedAgentId === agent.id
                              ? 'border-primary/60 bg-[hsl(var(--surface-2))]'
                              : 'border-border/50 bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-1))]'
                          }`}
                          aria-pressed={selectedAgentId === agent.id}
                        >
                          <StatusDot status={agent.status} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-mono text-foreground truncate">{agent.name}</div>
                            <div className="text-[11px] font-mono text-muted-foreground/55 truncate">{agent.role}</div>
                          </div>
                          {role === 'lead' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-primary/10 text-primary">
                              lead
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </section>

                {selectedAgent ? (
                  <InlineAgentDetailsCard agent={selectedAgent} activeTab={detailTab} onTabChange={setDetailTab} />
                ) : (
                  <section className="border border-border/50 rounded-md bg-[hsl(var(--surface-1))] flex items-center justify-center min-h-[28rem]">
                    <div className="text-center text-muted-foreground/30">
                      <span className="mb-3 text-4xl font-mono block">/</span>
                      <span className="text-sm font-mono block">
                        {members.length === 0 ? 'No lead assigned' : 'Select an agent'}
                      </span>
                      <span className="mt-1 text-xs font-mono text-muted-foreground/20 block">
                        {members.length === 0
                          ? 'Select an agent from the roster to view their details.'
                          : 'Click any team member to view details.'}
                      </span>
                    </div>
                  </section>
                )}
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
                    <Button variant="default" size="sm" onClick={() => setShowCreateAgentForm(true)}>
                      Add Member
                    </Button>
                  </div>
                </div>

                {showCreateAgentForm && (
                  <CreateTeamAgentForm
                    departmentName={dept?.name ?? ''}
                    teamName={team.name}
                    onClose={() => setShowCreateAgentForm(false)}
                    onCreated={async () => {
                      setShowCreateAgentForm(false)
                      await fetch('/api/org/scan?force=true')
                      window.location.reload()
                    }}
                  />
                )}

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
                                  <div className="flex items-center gap-2">
                                    <div className="text-sm text-foreground truncate font-mono">{agent.name}</div>
                                    {role === 'lead' && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                                        lead
                                      </span>
                                    )}
                                  </div>
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
                                  confirmingPromote === agent.id ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] font-mono text-amber-500/80">
                                        promote to lead?
                                      </span>
                                      <button
                                        onClick={async () => {
                                          await handleSetLead(agent.id)
                                          setConfirmingPromote(null)
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                      >
                                        yes
                                      </button>
                                      <button
                                        onClick={() => setConfirmingPromote(null)}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        className="px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        no
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmingPromote(agent.id)}
                                      onPointerDown={(event) => event.stopPropagation()}
                                      className="px-2 py-1 rounded text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
                                      title="Set as lead"
                                    >
                                      promote
                                    </button>
                                  )
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
  const { isReadOnly, canCreate } = useOrgData()
  const departments = useMissionControl((s) => s.departments)
  const teams = useMissionControl((s) => s.teams)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [deptFilter, setDeptFilter] = useState<number | null>(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [activeView, setActiveView] = useState<TeamView>('overview')
  const [showNewTeamForm, setShowNewTeamForm] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDept, setNewTeamDept] = useState<string>('')
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)

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
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            setShowNewTeamForm(true)
            setSelectedTeamId(null)
          }}
          disabled={!canCreate}
        >
          New Team
        </Button>
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
          {showNewTeamForm && (
            <div className="px-4 py-3 border-b border-border/50 bg-[hsl(var(--surface-1))] space-y-2">
              <div className="text-sm font-mono font-semibold text-foreground">Create New Team</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Team name"
                  className="flex-1 px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
                  autoFocus
                />
                <select
                  value={newTeamDept}
                  onChange={(e) => setNewTeamDept(e.target.value)}
                  className="px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground"
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="default"
                  size="sm"
                  disabled={!newTeamName.trim() || !newTeamDept || isCreatingTeam}
                  onClick={async () => {
                    setIsCreatingTeam(true)
                    try {
                      const res = await fetch('/api/teams', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newTeamName.trim(), department_name: newTeamDept }),
                      })
                      if (res.ok) {
                        setShowNewTeamForm(false)
                        setNewTeamName('')
                        setNewTeamDept('')
                        await fetch('/api/org/scan?force=true')
                        window.location.reload()
                      }
                    } finally {
                      setIsCreatingTeam(false)
                    }
                  }}
                >
                  Create
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowNewTeamForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

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
