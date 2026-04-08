'use client'

import { useEffect, useRef, useState } from 'react'
import { useMissionControl } from '@/store'

interface OrgSnapshot {
  departments: ReturnType<typeof useMissionControl.getState>['departments']
  teams: ReturnType<typeof useMissionControl.getState>['teams']
  agentAssignments: ReturnType<typeof useMissionControl.getState>['agentTeamAssignments']
  source: 'mock' | 'filesystem'
  rootPath: string | null
  scannedAt: number
}

interface ServerEvent {
  type: string
  data: OrgSnapshot
  timestamp: number
}

export function useOrgData() {
  const setDepartments = useMissionControl((state) => state.setDepartments)
  const setTeams = useMissionControl((state) => state.setTeams)
  const setAgentTeamAssignments = useMissionControl((state) => state.setAgentTeamAssignments)
  const setAgents = useMissionControl((state) => state.setAgents)
  const [orgSource, setOrgSource] = useState<'mock' | 'filesystem'>('mock')
  const [orgRootPath, setOrgRootPath] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [syncError, setSyncError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let mounted = true

    function applySnapshot(snapshot: OrgSnapshot) {
      if (!mounted) return
      setDepartments(snapshot.departments)
      setTeams(snapshot.teams)
      setAgentTeamAssignments(snapshot.agentAssignments)
      setOrgSource(snapshot.source)
      setOrgRootPath(snapshot.rootPath)
      setSyncError(null)
      setIsLoading(false)
    }

    async function loadSnapshot() {
      try {
        const [snapshotResponse, agentsResponse] = await Promise.all([
          fetch('/api/org/scan', { cache: 'no-store' }),
          fetch('/api/agents?limit=1000', { cache: 'no-store' }),
        ])

        if (!snapshotResponse.ok) {
          throw new Error(`Failed to load org snapshot (${snapshotResponse.status})`)
        }

        if (!agentsResponse.ok) {
          throw new Error(`Failed to load agents (${agentsResponse.status})`)
        }

        const snapshot = (await snapshotResponse.json()) as OrgSnapshot
        const agentsPayload = (await agentsResponse.json()) as { agents?: ReturnType<typeof useMissionControl.getState>['agents'] }
        applySnapshot(snapshot)
        setAgents(agentsPayload.agents ?? [])
      } catch (error) {
        if (!mounted) return
        setSyncError(error instanceof Error ? error.message : 'Failed to load org snapshot')
        setIsLoading(false)
      }
    }

    loadSnapshot()

    const eventSource = new EventSource('/api/org/stream')
    eventSourceRef.current = eventSource

    const handleConnected = (event: MessageEvent<string>) => {
      if (!mounted) return
      try {
        const payload = JSON.parse(event.data) as ServerEvent
        applySnapshot(payload.data)
      } catch {
        // Ignore malformed payloads.
      }
    }

    const handleUpdate = () => {
      void loadSnapshot()
    }

    eventSource.addEventListener('connected', handleConnected as EventListener)
    eventSource.addEventListener('org-update', handleUpdate as EventListener)
    eventSource.onerror = () => {
      if (!mounted) return
      setSyncError('Org stream disconnected')
    }

    return () => {
      mounted = false
      eventSource.removeEventListener('connected', handleConnected as EventListener)
      eventSource.removeEventListener('org-update', handleUpdate as EventListener)
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [setAgentTeamAssignments, setAgents, setDepartments, setTeams])

  return {
    orgSource,
    isLoading,
    syncError,
    isReadOnly: orgSource === 'filesystem',
    canCreate: Boolean(orgRootPath),
  }
}
