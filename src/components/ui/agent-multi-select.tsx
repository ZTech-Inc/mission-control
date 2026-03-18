'use client'

import { useState } from 'react'
import { useMissionControl } from '@/store'

interface AgentMultiSelectProps {
  teamId: number
  onAdd: (agentIds: number[]) => void
  onClose: () => void
}

export function AgentMultiSelect({ teamId, onAdd, onClose }: AgentMultiSelectProps) {
  const agents = useMissionControl((s) => s.agents)
  const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const assignedAgentIds = new Set(
    agentTeamAssignments.filter((a) => a.team_id === teamId).map((a) => a.agent_id)
  )

  const available = agents.filter(
    (agent) =>
      !assignedAgentIds.has(agent.id) &&
      (search === '' ||
        agent.name.toLowerCase().includes(search.toLowerCase()) ||
        agent.role.toLowerCase().includes(search.toLowerCase()))
  )

  function toggleAgent(agentId: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      return next
    })
  }

  function handleAdd() {
    onAdd(Array.from(selected))
    onClose()
  }

  return (
    <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-card border border-border rounded-lg shadow-lg">
      <div className="p-3 border-b border-border">
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1.5 text-sm bg-[hsl(var(--surface-0))] border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          autoFocus
        />
      </div>

      <div className="max-h-48 overflow-y-auto">
        {available.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground text-center">
            {agents.length === 0 ? 'No agents found' : 'All agents already in team'}
          </div>
        ) : (
          available.map((agent) => (
            <label
              key={agent.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-surface-1 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(agent.id)}
                onChange={() => toggleAgent(agent.id)}
                className="rounded"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">{agent.name}</div>
                <div className="text-xs text-muted-foreground truncate">{agent.role}</div>
              </div>
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  agent.status === 'idle'
                    ? 'bg-green-500'
                    : agent.status === 'busy'
                    ? 'bg-yellow-500'
                    : agent.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-gray-500'
                }`}
              />
            </label>
          ))
        )}
      </div>

      <div className="flex gap-2 p-3 border-t border-border">
        <button
          onClick={handleAdd}
          disabled={selected.size === 0}
          className="flex-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          Add Selected ({selected.size})
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-1 text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
