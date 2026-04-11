'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [isSyncingGithub, setIsSyncingGithub] = useState(false)
  const [lastGithubSyncMessage, setLastGithubSyncMessage] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const applySnapshot = useCallback((snapshot: OrgSnapshot) => {
    setDepartments(snapshot.departments)
    setTeams(snapshot.teams)
    setAgentTeamAssignments(snapshot.agentAssignments)
    setOrgSource(snapshot.source)
    setOrgRootPath(snapshot.rootPath)
    setSyncError(null)
    setIsLoading(false)
  }, [setAgentTeamAssignments, setDepartments, setTeams])

  const loadSnapshot = useCallback(async (options?: { force?: boolean }) => {
    const params = new URLSearchParams()
    if (options?.force) params.set('force', 'true')
    const query = params.toString()
    const scanUrl = `/api/org/scan${query ? `?${query}` : ''}`
    try {
      const [snapshotResponse, agentsResponse] = await Promise.all([
        fetch(scanUrl, { cache: 'no-store' }),
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
      setDepartments(snapshot.departments)
      setTeams(snapshot.teams)
      setAgentTeamAssignments(snapshot.agentAssignments)
      setOrgSource(snapshot.source)
      setOrgRootPath(snapshot.rootPath)
      setSyncError(null)
      setIsLoading(false)
      setAgents(agentsPayload.agents ?? [])
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Failed to load org snapshot')
      setIsLoading(false)
    }
  }, [setAgentTeamAssignments, setAgents, setDepartments, setTeams])

  const syncFromGithub = useCallback(async () => {
    setIsSyncingGithub(true)
    setSyncError(null)
    setLastGithubSyncMessage(null)
    try {
      const response = await fetch('/api/org/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-github' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(String(payload?.error || `GitHub sync failed (${response.status})`))
      }
      await loadSnapshot({ force: true })
      const from = String(payload?.sync?.beforeCommit || '').slice(0, 7)
      const to = String(payload?.sync?.afterCommit || '').slice(0, 7)
      const changed = Boolean(payload?.sync?.changed)
      if (from && to) {
        setLastGithubSyncMessage(changed ? `Synced ${from} -> ${to}` : `Already up to date (${to})`)
      } else {
        setLastGithubSyncMessage('GitHub sync completed')
      }
      return { ok: true as const, payload }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GitHub sync failed'
      setSyncError(message)
      setLastGithubSyncMessage(null)
      return { ok: false as const, error: message }
    } finally {
      setIsSyncingGithub(false)
    }
  }, [loadSnapshot])

  useEffect(() => {
    let mounted = true

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
  }, [applySnapshot, loadSnapshot])

  return {
    orgSource,
    isLoading,
    syncError,
    isReadOnly: orgSource === 'filesystem',
    canCreate: Boolean(orgRootPath),
    isSyncingGithub,
    lastGithubSyncMessage,
    syncFromGithub,
  }
}
