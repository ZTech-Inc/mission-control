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
  const [orgSource, setOrgSource] = useState<'mock' | 'filesystem'>('mock')
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
      setSyncError(null)
      setIsLoading(false)
    }

    async function loadSnapshot() {
      try {
        const response = await fetch('/api/org/scan', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`Failed to load org snapshot (${response.status})`)
        }

        const snapshot = (await response.json()) as OrgSnapshot
        applySnapshot(snapshot)
      } catch (error) {
        if (!mounted) return
        setSyncError(error instanceof Error ? error.message : 'Failed to load org snapshot')
        setIsLoading(false)
      }
    }

    loadSnapshot()

    const eventSource = new EventSource('/api/org/stream')
    eventSourceRef.current = eventSource

    eventSource.onmessage = (event) => {
      if (!mounted) return

      try {
        const payload = JSON.parse(event.data) as ServerEvent
        if (payload.type === 'connected' || payload.type === 'org.updated') {
          applySnapshot(payload.data)
        }
      } catch {
        // Ignore malformed payloads.
      }
    }

    eventSource.onerror = () => {
      if (!mounted) return
      setSyncError('Org stream disconnected')
    }

    return () => {
      mounted = false
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [setAgentTeamAssignments, setDepartments, setTeams])

  return {
    orgSource,
    isLoading,
    syncError,
    isReadOnly: orgSource === 'filesystem',
  }
}
