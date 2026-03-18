'use client'

import { useState, useEffect } from 'react'
import { DndContext, DragEndEvent, useDroppable, useDraggable } from '@dnd-kit/core'
import { useMissionControl } from '@/store'
import type { Department, Team, Agent } from '@/store'
import { EntityListSidebar } from '@/components/ui/entity-list-sidebar'
import { OrgDocsPanel } from '@/components/panels/org-docs-panel'
import { MOCK_DEPARTMENTS, MOCK_TEAMS, MOCK_AGENT_ASSIGNMENTS } from '@/lib/mock-org-data'

// --- dnd-kit helpers ---

function DroppableZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg p-3 min-h-[60px] transition-colors ${
        isOver ? 'border-primary border-dashed bg-primary/5' : 'border-border'
      }`}
    >
      {children}
    </div>
  )
}

function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` }
          : undefined
      }
      className={isDragging ? 'opacity-50' : ''}
    >
      {children}
    </div>
  )
}

// --- Status dot ---

function StatusDot({ status }: { status: Agent['status'] }) {
  const color =
    status === 'idle'
      ? 'bg-green-500'
      : status === 'busy'
      ? 'bg-yellow-500'
      : status === 'error'
      ? 'bg-red-500'
      : 'bg-gray-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
}

// --- Department Detail ---

type DeptTab = 'overview' | 'teams' | 'agents' | 'docs'

interface DepartmentDetailProps {
  dept: Department
}

function DepartmentDetail({ dept }: DepartmentDetailProps) {
  const [tab, setTab] = useState<DeptTab>('overview')
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDesc, setNewTeamDesc] = useState('')

  const teams = useMissionControl((s) => s.teams)
  const agents = useMissionControl((s) => s.agents)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const addTeam = useMissionControl((s) => s.addTeam)
  const assignAgentToTeam = useMissionControl((s) => s.assignAgentToTeam)

  const deptTeams = teams.filter((t) => t.department_id === dept.id)
  const deptAgentIds = new Set(
    agentTeamAssignments
      .filter((a) => deptTeams.some((t) => t.id === a.team_id))
      .map((a) => a.agent_id)
  )
  const deptAgentCount = deptAgentIds.size

  function handleAddTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!newTeamName.trim()) return
    const now = Math.floor(Date.now() / 1000)
    addTeam({
      id: Date.now(),
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
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const agentId = parseInt(String(active.id).replace('agent-', ''), 10)
    const teamId = parseInt(String(over.id).replace('team-drop-', ''), 10)
    if (!isNaN(agentId) && !isNaN(teamId)) {
      assignAgentToTeam(agentId, teamId, 'member')
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: dept.color ?? '#888' }}
        />
        <h2 className="text-xl font-semibold text-foreground">{dept.name}</h2>
      </div>
      {dept.description && (
        <p className="text-sm text-muted-foreground mb-4">{dept.description}</p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4">
        {(['overview', 'teams', 'agents', 'docs'] as const).map((t) => (
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
              <div className="text-2xl font-bold text-foreground">{deptTeams.length}</div>
              <div className="text-sm text-muted-foreground">Teams</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-2xl font-bold text-foreground">{deptAgentCount}</div>
              <div className="text-sm text-muted-foreground">Agents</div>
            </div>
          </div>
          <div className="space-y-2">
            {deptTeams.map((team) => {
              const memberCount = agentTeamAssignments.filter(
                (a) => a.team_id === team.id
              ).length
              return (
                <div
                  key={team.id}
                  className="bg-card border border-border rounded-lg p-3 flex items-center gap-3"
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: team.color ?? '#888' }}
                  />
                  <span className="flex-1 text-sm text-foreground">{team.name}</span>
                  <span className="text-xs text-muted-foreground">{memberCount} agents</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Teams */}
      {tab === 'teams' && (
        <div>
          <div className="flex justify-end mb-3">
            <button
              onClick={() => setShowAddTeam((v) => !v)}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-1 text-foreground transition-colors"
            >
              + Add Team
            </button>
          </div>
          {showAddTeam && (
            <form onSubmit={handleAddTeam} className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Team Name</label>
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Team name"
                  className="w-full px-2 py-1.5 text-sm bg-[hsl(var(--surface-0))] border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Description</label>
                <input
                  type="text"
                  value={newTeamDesc}
                  onChange={(e) => setNewTeamDesc(e.target.value)}
                  placeholder="Optional description"
                  className="w-full px-2 py-1.5 text-sm bg-[hsl(var(--surface-0))] border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
                >
                  Create Team
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddTeam(false)}
                  className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-1 text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {deptTeams.map((team) => {
              const memberCount = agentTeamAssignments.filter(
                (a) => a.team_id === team.id
              ).length
              return (
                <div
                  key={team.id}
                  className="bg-card border border-border rounded-lg p-4"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: team.color ?? '#888' }}
                    />
                    <span className="font-medium text-sm text-foreground">{team.name}</span>
                  </div>
                  {team.description && (
                    <p className="text-xs text-muted-foreground mb-2">{team.description}</p>
                  )}
                  <div className="text-xs text-muted-foreground">{memberCount} agents</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Agents */}
      {tab === 'agents' && (
        <DndContext onDragEnd={handleDragEnd}>
          <div className="space-y-4">
            {deptTeams.map((team) => {
              const teamAssignments = agentTeamAssignments.filter(
                (a) => a.team_id === team.id
              )
              const teamAgents = teamAssignments
                .map((a) => ({
                  agent: agents.find((ag) => ag.id === a.agent_id),
                  role: a.role,
                }))
                .filter((x): x is { agent: Agent; role: 'member' | 'lead' } => !!x.agent)

              return (
                <div key={team.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: team.color ?? '#888' }}
                    />
                    <h3 className="text-sm font-medium text-foreground">{team.name}</h3>
                    <span className="text-xs text-muted-foreground">
                      ({teamAgents.length})
                    </span>
                  </div>
                  <DroppableZone id={`team-drop-${team.id}`}>
                    {teamAgents.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-2 text-center">
                        No agents — drag here to assign
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {teamAgents.map(({ agent, role }) => (
                          <DraggableCard key={agent.id} id={`agent-${agent.id}`}>
                            <div className="flex items-center gap-2 p-2 bg-[hsl(var(--surface-0))] rounded cursor-grab">
                              <StatusDot status={agent.status} />
                              <span className="flex-1 text-sm text-foreground truncate">
                                {agent.name}
                              </span>
                              <span className="text-xs text-muted-foreground">{role}</span>
                            </div>
                          </DraggableCard>
                        ))}
                      </div>
                    )}
                  </DroppableZone>
                </div>
              )
            })}
          </div>
        </DndContext>
      )}

      {/* Docs */}
      {tab === 'docs' && <OrgDocsPanel entityType="department" entityId={dept.id} />}
    </div>
  )
}

// --- Create Department Form ---

interface CreateDeptFormProps {
  onSubmit: (name: string, color: string) => void
  onCancel: () => void
}

function CreateDeptForm({ onSubmit, onCancel }: CreateDeptFormProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#89b4fa')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit(name.trim(), color)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-4 mb-6 space-y-3">
      <h3 className="text-sm font-medium text-foreground">New Department</h3>
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Department name"
          className="w-full px-2 py-1.5 text-sm bg-[hsl(var(--surface-0))] border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Color</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-10 h-8 rounded border border-border cursor-pointer"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-1 text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// --- Main Panel ---

export function DepartmentsPanel() {
  const departments = useMissionControl((s) => s.departments)
  const teams = useMissionControl((s) => s.teams)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const setDepartments = useMissionControl((s) => s.setDepartments)
  const setTeams = useMissionControl((s) => s.setTeams)
  const setAgentTeamAssignments = useMissionControl((s) => s.setAgentTeamAssignments)
  const addDepartment = useMissionControl((s) => s.addDepartment)

  const [selectedDept, setSelectedDept] = useState<Department | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    if (departments.length === 0) setDepartments(MOCK_DEPARTMENTS)
    if (teams.length === 0) setTeams(MOCK_TEAMS)
    if (agentTeamAssignments.length === 0) setAgentTeamAssignments(MOCK_AGENT_ASSIGNMENTS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select first department
  useEffect(() => {
    if (!selectedDept && departments.length > 0) {
      setSelectedDept(departments[0])
    }
  }, [departments, selectedDept])

  function handleCreate(name: string, color: string) {
    const now = Math.floor(Date.now() / 1000)
    const newDept: Department = {
      id: Date.now(),
      name,
      color,
      created_at: now,
      updated_at: now,
    }
    addDepartment(newDept)
    setSelectedDept(newDept)
    setShowCreateForm(false)
  }

  const teamCountByDept = (deptId: number) =>
    teams.filter((t) => t.department_id === deptId).length

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <EntityListSidebar
        items={departments}
        selectedId={selectedDept?.id ?? null}
        onSelect={(dept) => {
          setSelectedDept(dept)
          setShowCreateForm(false)
        }}
        renderItem={(dept, _isSelected) => (
          <div className="flex items-center gap-2 px-3 py-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: dept.color ?? '#888' }}
            />
            <span className="flex-1 text-sm truncate">{dept.name}</span>
            <span className="text-xs text-muted-foreground">{teamCountByDept(dept.id)}</span>
          </div>
        )}
        createLabel="New Department"
        onCreate={() => {
          setShowCreateForm(true)
          setSelectedDept(null)
        }}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      {/* Detail Pane */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        {showCreateForm ? (
          <CreateDeptForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateForm(false)}
          />
        ) : selectedDept ? (
          <DepartmentDetail dept={selectedDept} />
        ) : (
          <div className="text-muted-foreground text-sm">
            Select a department from the sidebar
          </div>
        )}
      </div>
    </div>
  )
}
