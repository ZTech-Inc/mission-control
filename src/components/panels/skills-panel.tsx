'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'
import {
  getSkillSourceLabel,
  SkillContentViewer,
  type SkillContentResponse,
  type SkillSummary,
} from '@/components/panels/skill-content-viewer'

interface SkillGroup {
  source: string
  path: string
  skills: SkillSummary[]
}

interface SkillsResponse {
  skills: SkillSummary[]
  groups: SkillGroup[]
  total: number
}

interface RegistrySkill {
  slug: string
  name: string
  description: string
  author: string
  version: string
  source: string
  installCount?: number
  tags?: string[]
}

type PanelTab = 'installed' | 'registry'

export function getSourceLabel(source: string): string {
  return getSkillSourceLabel(source)
}

export function SkillsPanel() {
  const t = useTranslations('skills')
  const { dashboardMode, skillsList, skillGroups, skillsTotal, setSkillsData } = useMissionControl()
  const [loading, setLoading] = useState(skillsList === null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeRoot, setActiveRoot] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null)
  const [selectedContent, setSelectedContent] = useState<SkillContentResponse | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [createSource, setCreateSource] = useState(dashboardMode === 'full' ? 'openclaw' : 'user-codex')
  const [createName, setCreateName] = useState('')
  const [createContent, setCreateContent] = useState('# new-skill\n\nDescribe this skill.\n')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('installed')
  const [registrySource, setRegistrySource] = useState<'clawhub' | 'skills-sh' | 'awesome-openclaw'>('awesome-openclaw')
  const [registryQuery, setRegistryQuery] = useState('')
  const [registryResults, setRegistryResults] = useState<RegistrySkill[]>([])
  const [registryLoading, setRegistryLoading] = useState(false)
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [registrySearched, setRegistrySearched] = useState(false)
  const [installTarget, setInstallTarget] = useState(dashboardMode === 'full' ? 'openclaw' : 'user-agents')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [scanAll, setScanAll] = useState<{
    running: boolean
    total: number
    done: number
    current: string | null
    results: { clean: number; warning: number; rejected: number; error: number }
  } | null>(null)
  const [installModal, setInstallModal] = useState<{
    slug: string
    name: string
    step: 'fetching' | 'scanning' | 'writing' | 'done' | 'error'
    message?: string
    securityStatus?: string
  } | null>(null)
  const selectedSkillIsReadOnly = selectedSkill?.source.startsWith('org-agent:') ?? false

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const loadSkills = useCallback(async (opts?: { initial?: boolean }) => {
    if (opts?.initial) setLoading(true)
    setError(null)
    const res = await fetch('/api/skills', { cache: 'no-store' })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error || 'Failed to load skills')
    const resp = body as SkillsResponse
    setSkillsData(resp.skills, resp.groups, resp.total)
    if (opts?.initial) setLoading(false)
  }, [setSkillsData])

  useEffect(() => {
    // Skip initial fetch if we already have cached data from a previous mount
    if (skillsList !== null) return
    let cancelled = false
    async function run() {
      try {
        await loadSkills({ initial: true })
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load skills')
          setLoading(false)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [loadSkills, skillsList])

  // Two-way disk sync: poll for external on-disk changes.
  useEffect(() => {
    const id = window.setInterval(() => {
      loadSkills().catch(() => {})
    }, 10000)
    return () => window.clearInterval(id)
  }, [loadSkills])

  const filtered = useMemo(() => {
    let list = skillsList || []
    if (activeRoot) list = list.filter((s) => s.source === activeRoot)
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((skill) => {
      const haystack = `${skill.name} ${skill.source} ${skill.description || ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [skillsList, query, activeRoot])

  const visibleGroups = useMemo(
    () =>
      (skillGroups || []).filter(
        (group) =>
          group.skills.length > 0 ||
          ['user-agents', 'user-codex', 'openclaw', 'workspace'].includes(group.source) ||
          group.source.startsWith('workspace-') ||
          group.source.startsWith('org-agent:'),
      ),
    [skillGroups],
  )

  const orgAgentGroups = useMemo(
    () => visibleGroups.filter((group) => group.source.startsWith('org-agent:')),
    [visibleGroups],
  )

  const defaultGroups = useMemo(
    () => visibleGroups.filter((group) => !group.source.startsWith('org-agent:')),
    [visibleGroups],
  )

  useEffect(() => {
    if (!selectedSkill) return
    const skill = selectedSkill
    let cancelled = false
    async function run() {
      setDrawerLoading(true)
      setDrawerError(null)
      setSelectedContent(null)
      try {
        const params = new URLSearchParams({
          mode: 'content',
          source: skill.source,
          name: skill.name,
        })
        const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Failed to load SKILL.md')
        if (!cancelled) setSelectedContent(body as SkillContentResponse)
      } catch (err: any) {
        if (!cancelled) setDrawerError(err?.message || 'Failed to load SKILL.md')
      } finally {
        if (!cancelled) setDrawerLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedSkill])

  useEffect(() => {
    setDraftContent(selectedContent?.content || '')
  }, [selectedContent?.content])

  useEffect(() => {
    if (!selectedSkill) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedSkill(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedSkill])

  const refresh = async () => {
    setLoading(true)
    try {
      await loadSkills()
    } catch (err: any) {
      setError(err?.message || 'Failed to refresh skills')
    } finally {
      setLoading(false)
    }
  }

  const createSkill = async () => {
    setCreateError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: createSource,
          name: createName.trim(),
          content: createContent,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to create skill')
      setCreateName('')
      await loadSkills()
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }

  const saveSkill = async () => {
    if (!selectedSkill) return
    setSaving(true)
    setDrawerError(null)
    try {
      const res = await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: selectedSkill.source,
          name: selectedSkill.name,
          content: draftContent,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to save skill')
      await loadSkills()
      setSelectedContent((prev) => prev ? { ...prev, content: draftContent } : prev)
    } catch (err: any) {
      setDrawerError(err?.message || 'Failed to save skill')
    } finally {
      setSaving(false)
    }
  }

  const deleteSkill = async () => {
    if (!selectedSkill) return
    const ok = window.confirm(`Delete skill "${selectedSkill.name}"? This removes it from disk.`)
    if (!ok) return
    setSaving(true)
    setDrawerError(null)
    try {
      const params = new URLSearchParams({ source: selectedSkill.source, name: selectedSkill.name })
      const res = await fetch(`/api/skills?${params.toString()}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to delete skill')
      setSelectedSkill(null)
      setSelectedContent(null)
      await loadSkills()
    } catch (err: any) {
      setDrawerError(err?.message || 'Failed to delete skill')
    } finally {
      setSaving(false)
    }
  }

  const searchRegistry = async () => {
    if (!registryQuery.trim()) return
    setRegistryLoading(true)
    setRegistryError(null)
    try {
      const params = new URLSearchParams({ source: registrySource, q: registryQuery.trim() })
      const res = await fetch(`/api/skills/registry?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Search failed')
      setRegistryResults(body?.skills || [])
      setRegistrySearched(true)
    } catch (err: any) {
      setRegistryError(err?.message || 'Search failed')
    } finally {
      setRegistryLoading(false)
    }
  }

  const installSkill = async (slug: string, skillName?: string) => {
    const displayName = skillName || slug.split('/').pop() || slug
    setInstalling(slug)
    setInstallMessage(null)
    setInstallModal({ slug, name: displayName, step: 'fetching' })
    try {
      // Simulate step progression — the API does fetch+scan+write in one call,
      // so we show intermediate steps on a timer for UX feedback
      const stepTimer = setTimeout(() => {
        setInstallModal(prev => prev?.slug === slug ? { ...prev, step: 'scanning' } : prev)
      }, 800)
      const writeTimer = setTimeout(() => {
        setInstallModal(prev => prev?.slug === slug ? { ...prev, step: 'writing' } : prev)
      }, 1600)

      const res = await fetch('/api/skills/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: registrySource, slug, targetRoot: installTarget }),
      })
      const body = await res.json()
      clearTimeout(stepTimer)
      clearTimeout(writeTimer)

      if (!res.ok) {
        const msg = body?.message || body?.error || 'Install failed'
        setInstallModal({ slug, name: displayName, step: 'error', message: msg, securityStatus: body?.securityReport?.status })
      } else {
        setInstallModal({ slug, name: displayName, step: 'done', message: body?.message || 'Installed successfully', securityStatus: body?.securityReport?.status })
        await loadSkills()
      }
    } catch (err: any) {
      setInstallModal({ slug, name: displayName, step: 'error', message: err?.message || 'Network error' })
    } finally {
      setInstalling(null)
    }
  }

  const checkSecurity = async (skill: SkillSummary) => {
    try {
      const params = new URLSearchParams({ mode: 'check', source: skill.source, name: skill.name })
      const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (res.ok && body?.security) {
        await loadSkills() // refresh to pick up updated security_status
      }
    } catch { /* best-effort */ }
  }

  const scanAllSkills = async () => {
    const skills = skillsList || []
    if (skills.length === 0) return
    const state = {
      running: true,
      total: skills.length,
      done: 0,
      current: null as string | null,
      results: { clean: 0, warning: 0, rejected: 0, error: 0 },
    }
    setScanAll({ ...state })

    for (const skill of skills) {
      state.current = skill.name
      setScanAll({ ...state })
      try {
        const params = new URLSearchParams({ mode: 'check', source: skill.source, name: skill.name })
        const res = await fetch(`/api/skills?${params.toString()}`, { cache: 'no-store' })
        const body = await res.json()
        if (res.ok && body?.security) {
          const s = body.security.status as string
          if (s === 'clean') state.results.clean++
          else if (s === 'warning') state.results.warning++
          else if (s === 'rejected') state.results.rejected++
          else state.results.clean++
        } else {
          state.results.error++
        }
      } catch {
        state.results.error++
      }
      state.done++
      setScanAll({ ...state })
    }

    state.running = false
    state.current = null
    setScanAll({ ...state })
    await loadSkills()
  }

  const securityBadge = (status?: string | null) => {
    if (!status || status === 'unchecked') return <span className="text-2xs text-muted-foreground/50">unchecked</span>
    if (status === 'clean') return <span className="text-2xs text-emerald-400">clean</span>
    if (status === 'warning') return <span className="text-2xs text-amber-400">warning</span>
    if (status === 'rejected') return <span className="text-2xs text-rose-400">rejected</span>
    return null
  }

  const renderSourceCards = (groups: SkillGroup[], options?: { imported?: boolean }) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => (
        <button
          key={group.source}
          onClick={() => setActiveRoot(activeRoot === group.source ? null : group.source)}
          className={`rounded-lg border bg-card p-3 text-left transition-colors ${
            activeRoot === group.source
              ? 'border-primary ring-1 ring-primary/30'
              : group.source === 'openclaw'
                ? 'border-cyan-500/30 hover:border-cyan-500/50'
                : group.source.startsWith('org-agent:')
                  ? 'border-emerald-500/30 hover:border-emerald-500/50'
                  : group.source.startsWith('workspace-')
                    ? 'border-violet-500/30 hover:border-violet-500/50'
                    : 'border-border hover:border-border/80'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-muted-foreground">{getSourceLabel(group.source)}</div>
            {options?.imported ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                Imported from agent workspace
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-lg font-semibold text-foreground">{group.skills.length}</div>
          <div className="mt-1 truncate text-2xs text-muted-foreground">{group.path}</div>
        </button>
      ))}
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('subtitle')} {dashboardMode === 'local' ? t('localMode') : t('gatewayMode')}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('installed')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTab === 'installed' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            {t('tabInstalled')}
          </button>
          <button
            onClick={() => setActiveTab('registry')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTab === 'registry' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}
          >
            {t('tabRegistry')}
          </button>
        </div>
      </div>

      {installMessage && (
        <div className={`rounded-lg border px-4 py-2 text-xs ${
          installMessage.startsWith('Failed') || installMessage.startsWith('Install error')
            ? 'bg-destructive/10 border-destructive/30 text-destructive'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        }`}>
          {installMessage}
        </div>
      )}

      {activeTab === 'installed' && (
        <>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="h-9 w-full rounded-md border border-border bg-secondary/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground text-xs"
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>
          {query && (
            <div className="text-2xs text-muted-foreground">
              {t('searchResults', { count: filtered.length, total: skillsTotal, query })}
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">{t('diskSyncActive')}</div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={scanAllSkills}
                  disabled={loading || saving || !!scanAll?.running}
                >
                  {scanAll?.running ? t('scanningProgress', { done: scanAll.done, total: scanAll.total }) : t('scanAll')}
                </Button>
                <Button variant="outline" size="xs" onClick={refresh} disabled={loading || saving}>{t('refreshNow')}</Button>
              </div>
            </div>

            {/* Scan All progress / results */}
            {scanAll && (
              <div className="space-y-2">
                {scanAll.running && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-2xs text-muted-foreground">
                      <span>{t('scanning')} <span className="text-foreground font-medium">{scanAll.current}</span></span>
                      <span>{scanAll.done}/{scanAll.total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${(scanAll.done / scanAll.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {!scanAll.running && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-2xs">
                      <span className="text-emerald-400">{scanAll.results.clean} clean</span>
                      {scanAll.results.warning > 0 && <span className="text-amber-400">{scanAll.results.warning} warning</span>}
                      {scanAll.results.rejected > 0 && <span className="text-rose-400">{scanAll.results.rejected} rejected</span>}
                      {scanAll.results.error > 0 && <span className="text-destructive">{scanAll.results.error} errors</span>}
                      <span className="text-muted-foreground">— {t('skillsScanned', { count: scanAll.total })}</span>
                    </div>
                    <button onClick={() => setScanAll(null)} className="text-2xs text-muted-foreground/50 hover:text-foreground">{t('dismiss')}</button>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr_auto] gap-2">
              <select
                value={createSource}
                onChange={(e) => setCreateSource(e.target.value)}
                disabled={selectedSkillIsReadOnly}
                className="h-9 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground"
              >
                <option value="user-agents">{getSourceLabel('user-agents')}</option>
                <option value="user-codex">{getSourceLabel('user-codex')}</option>
                <option value="project-agents">{getSourceLabel('project-agents')}</option>
                <option value="project-codex">{getSourceLabel('project-codex')}</option>
                {dashboardMode === 'full' && (
                  <option value="openclaw">{getSourceLabel('openclaw')}</option>
                )}
                <option value="workspace">{getSourceLabel('workspace')}</option>
              </select>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={selectedSkillIsReadOnly}
                placeholder="new-skill-name"
                className="h-9 rounded-md border border-border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <Button variant="default" size="sm" onClick={createSkill} disabled={saving || !createName.trim() || selectedSkillIsReadOnly}>
                {t('addSkill')}
              </Button>
            </div>
            <textarea
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              disabled={selectedSkillIsReadOnly}
              className="w-full h-24 rounded-md border border-border bg-secondary/30 p-2 text-xs text-foreground font-mono focus:outline-none"
              placeholder={t('initialContent')}
            />
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </div>

          {loading ? (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t('loadingSkills')}</div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-destructive">{error}</div>
          ) : (
            <>
              <div className="space-y-4">
                {activeRoot && (
                  <button
                    onClick={() => setActiveRoot(null)}
                    className="text-left text-2xs text-primary hover:underline"
                  >
                    {t('showAllRoots')}
                  </button>
                )}

                {orgAgentGroups.length > 0 ? (
                  <section className="space-y-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Imported Agent Skills</h3>
                      <p className="text-xs text-muted-foreground">
                        Read-only skills imported from agent workspaces during org scans.
                      </p>
                    </div>
                    {renderSourceCards(orgAgentGroups, { imported: true })}
                  </section>
                ) : null}

                {defaultGroups.length > 0 ? (
                  <section className="space-y-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Global and Project Skill Sources</h3>
                    </div>
                    {renderSourceCards(defaultGroups)}
                  </section>
                ) : null}
              </div>

              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
                  {t('skillCount', { count: filtered.length, total: skillsTotal })}
                </div>
                {filtered.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">{t('noMatch')}</div>
                ) : (
                  <div className="divide-y divide-border">
                    {filtered.map((skill) => (
                      <div key={skill.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-sm text-foreground">{skill.name}</div>
                            {skill.registry_slug && (
                              <span className="text-2xs rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 px-1.5 py-0.5">
                                registry
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {securityBadge(skill.security_status)}
                            <span className={`text-2xs rounded-full border px-2 py-0.5 ${
                              skill.source === 'openclaw'
                                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                                : skill.source.startsWith('org-agent:')
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : skill.source.startsWith('workspace-')
                                  ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
                                  : skill.source.startsWith('project-')
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                    : 'border-border text-muted-foreground'
                            }`}>
                              {getSourceLabel(skill.source)}
                            </span>
                            <Button variant="outline" size="xs" onClick={() => checkSecurity(skill)}>
                              {t('scan')}
                            </Button>
                            <Button variant="outline" size="xs" onClick={() => setSelectedSkill(skill)}>
                              {t('view')}
                            </Button>
                          </div>
                        </div>
                        {skill.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                        )}
                        <p className="mt-1 text-2xs text-muted-foreground/70 break-all">{skill.path}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'registry' && (
        <>
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="flex items-center gap-2">
              <select
                value={registrySource}
                onChange={(e) => { setRegistrySource(e.target.value as 'clawhub' | 'skills-sh' | 'awesome-openclaw'); setRegistryResults([]); setRegistrySearched(false) }}
                className="h-9 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground"
              >
                <option value="clawhub">ClawdHub</option>
                <option value="skills-sh">skills.sh</option>
                <option value="awesome-openclaw">Awesome OpenClaw</option>
              </select>
              <input
                value={registryQuery}
                onChange={(e) => setRegistryQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchRegistry()}
                placeholder={t('registrySearchPlaceholder')}
                className="h-9 flex-1 rounded-md border border-border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <Button variant="default" size="sm" onClick={searchRegistry} disabled={registryLoading || !registryQuery.trim()}>
                {registryLoading ? t('searching') : t('search')}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('installTo')}</span>
              <select
                value={installTarget}
                onChange={(e) => setInstallTarget(e.target.value)}
                className="h-7 rounded-md border border-border bg-secondary/50 px-2 text-xs text-foreground"
              >
                <option value="user-agents">{getSourceLabel('user-agents')}</option>
                <option value="user-codex">{getSourceLabel('user-codex')}</option>
                <option value="project-agents">{getSourceLabel('project-agents')}</option>
                <option value="project-codex">{getSourceLabel('project-codex')}</option>
                {dashboardMode === 'full' && (
                  <option value="openclaw">{getSourceLabel('openclaw')}</option>
                )}
                <option value="workspace">{getSourceLabel('workspace')}</option>
              </select>
            </div>
          </div>

          {registryError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {registryError}
            </div>
          )}

          {registryResults.length > 0 ? (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">
                {registryResults.length} results from {{ clawhub: 'ClawdHub', 'skills-sh': 'skills.sh', 'awesome-openclaw': 'Awesome OpenClaw' }[registrySource]}
              </div>
              <div className="divide-y divide-border">
                {registryResults.map((skill) => (
                  <div key={skill.slug} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-sm text-foreground">{skill.name}</div>
                        <div className="text-2xs text-muted-foreground mt-0.5">
                          by {skill.author} • v{skill.version}
                          {skill.installCount != null && ` • ${skill.installCount} installs`}
                        </div>
                      </div>
                      <Button
                        variant="default"
                        size="xs"
                        onClick={() => installSkill(skill.slug, skill.name)}
                        disabled={installing === skill.slug}
                      >
                        {installing === skill.slug ? t('installing') : t('install')}
                      </Button>
                    </div>
                    {skill.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                    )}
                    {skill.tags && skill.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {skill.tags.slice(0, 5).map((tag) => (
                          <span key={tag} className="text-2xs rounded-full bg-secondary/50 border border-border px-1.5 py-0.5 text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : registryLoading ? (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t('searching')}</div>
          ) : registrySearched ? (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              {t('noRegistryResults', { query: registryQuery, registry: { clawhub: 'ClawdHub', 'skills-sh': 'skills.sh', 'awesome-openclaw': 'Awesome OpenClaw' }[registrySource] })}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              {t('registryPrompt')}
            </div>
          )}
        </>
      )}

      {isMounted && installModal && createPortal(
        <div className="fixed inset-0 z-[130]">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
              <div className="px-5 pt-5 pb-4">
                <h3 className="text-sm font-semibold text-foreground">
                  {installModal.step === 'done' ? t('skillInstalled') : installModal.step === 'error' ? t('installFailed') : t('installingSkill')}
                </h3>
                <p className="text-xs text-muted-foreground mt-1 truncate">{installModal.name}</p>
              </div>

              <div className="px-5 pb-5 space-y-3">
                {/* Progress steps */}
                <div className="space-y-2">
                  <InstallStep
                    label={t('stepFetching')}
                    status={installModal.step === 'fetching' ? 'active' : installModal.step === 'error' && !installModal.securityStatus ? 'error' : 'done'}
                  />
                  <InstallStep
                    label={t('stepScanning')}
                    status={
                      installModal.step === 'fetching' ? 'pending'
                        : installModal.step === 'scanning' ? 'active'
                        : installModal.step === 'error' && installModal.securityStatus === 'rejected' ? 'error'
                        : installModal.step === 'error' && !installModal.securityStatus ? 'error'
                        : 'done'
                    }
                  />
                  <InstallStep
                    label={t('stepWriting')}
                    status={
                      ['fetching', 'scanning'].includes(installModal.step) ? 'pending'
                        : installModal.step === 'writing' ? 'active'
                        : installModal.step === 'error' ? 'error'
                        : 'done'
                    }
                  />
                </div>

                {/* Result message */}
                {installModal.message && (installModal.step === 'done' || installModal.step === 'error') && (
                  <div className={`rounded-md border px-3 py-2 text-xs ${
                    installModal.step === 'error'
                      ? 'bg-destructive/10 border-destructive/30 text-destructive'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  }`}>
                    {installModal.message}
                  </div>
                )}

                {/* Security badge */}
                {installModal.securityStatus && installModal.step === 'done' && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{t('security')}</span>
                    <span className={
                      installModal.securityStatus === 'clean' ? 'text-emerald-400'
                        : installModal.securityStatus === 'warning' ? 'text-amber-400'
                        : 'text-rose-400'
                    }>{installModal.securityStatus}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              {(installModal.step === 'done' || installModal.step === 'error') && (
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  {installModal.step === 'done' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setInstallModal(null); setActiveTab('installed') }}
                    >
                      {t('viewInstalled')}
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setInstallModal(null)}
                  >
                    {installModal.step === 'done' ? t('done') : t('close')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {isMounted && selectedSkill && createPortal(
        <div className="fixed inset-0 z-[120]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedSkill(null)} />
          <aside className="absolute right-0 top-0 h-full w-[min(52rem,100vw)] bg-card border-l border-border shadow-2xl flex flex-col">
            <SkillContentViewer
              skill={selectedSkill}
              content={selectedContent}
              loading={drawerLoading}
              error={drawerError}
              readOnly={selectedSkillIsReadOnly}
              value={draftContent}
              onValueChange={setDraftContent}
              emptyMessage={t('noContent')}
              actions={
                <>
                  {!selectedSkillIsReadOnly && (
                    <Button variant="destructive" size="sm" onClick={deleteSkill} disabled={saving || drawerLoading}>
                      {t('delete')}
                    </Button>
                  )}
                  {!selectedSkillIsReadOnly && (
                    <Button variant="outline" size="sm" onClick={saveSkill} disabled={saving || drawerLoading}>
                      {t('save')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedSkill(null)}>
                    {t('close')}
                  </Button>
                </>
              }
              footer={selectedSkillIsReadOnly ? 'Imported org-agent skills are read-only in the catalog.' : null}
            />
          </aside>
        </div>,
        document.body
      )}
    </div>
  )
}

function InstallStep({ label, status }: { label: string; status: 'pending' | 'active' | 'done' | 'error' }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-5 h-5 flex items-center justify-center shrink-0">
        {status === 'pending' && (
          <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
        )}
        {status === 'active' && (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        )}
        {status === 'done' && (
          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        )}
        {status === 'error' && (
          <svg className="w-4 h-4 text-destructive" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" />
          </svg>
        )}
      </div>
      <span className={`text-xs ${
        status === 'active' ? 'text-foreground font-medium'
          : status === 'done' ? 'text-muted-foreground'
          : status === 'error' ? 'text-destructive'
          : 'text-muted-foreground/50'
      }`}>
        {label}
      </span>
    </div>
  )
}
