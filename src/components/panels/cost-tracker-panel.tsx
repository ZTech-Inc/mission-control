'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts'

const log = createClientLogger('CostTracker')

// ── Types ──────────────────────────────────────────

interface TokenStats {
  totalTokens: number; totalCost: number; requestCount: number
  avgTokensPerRequest: number; avgCostPerRequest: number
}

interface UsageStats {
  summary: TokenStats
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  timeframe: string
  recordCount: number
}

interface TrendData {
  trends: Array<{ timestamp: string; tokens: number; cost: number; requests: number }>
  timeframe: string
}

interface ByAgentModelBreakdown {
  model: string; input_tokens: number; output_tokens: number; request_count: number; cost: number
}

interface ByAgentEntry {
  agent: string; total_input_tokens: number; total_output_tokens: number
  total_tokens: number; total_cost: number; session_count: number
  request_count: number; last_active: string; models: ByAgentModelBreakdown[]
}

interface ByAgentResponse {
  agents: ByAgentEntry[]
  summary: { total_cost: number; total_tokens: number; agent_count: number; days: number }
}

interface TaskCostEntry {
  taskId: number; title: string; status: string; priority: string
  assignedTo?: string | null
  project: { id?: number | null; name?: string | null; slug?: string | null; ticketRef?: string | null }
  stats: TokenStats
  models: Record<string, TokenStats>
}

interface TaskCostsResponse {
  summary: TokenStats
  tasks: TaskCostEntry[]
  agents: Record<string, { stats: TokenStats; taskCount: number; taskIds: number[] }>
  unattributed: TokenStats
  timeframe: string
}

interface SessionCostEntry {
  sessionId: string; sessionKey?: string; model: string
  totalTokens: number; inputTokens: number; outputTokens: number
  totalCost: number; requestCount: number; firstSeen: string; lastSeen: string
}

interface SessionPoolAccountView {
  id: number
  label: string
  provider: string
  runtimeType?: string | null
  preferredModel?: string | null
  credentialRef?: string | null
  metadata?: { reasoningEffort?: string | null; [key: string]: unknown }
  enabled: boolean
  health: { state: string; reason: string; consecutiveFailures: number; cooldownUntil?: number | null }
  usage: {
    cost30d: number
    requestCount30d: number
    totalTokens30d: number
    totalTokens1d: number
    requestCount1d: number
    monthlyBudgetPct?: number | null
    dailyTokenPct?: number | null
    dailyRequestPct?: number | null
    maxLimitPct?: number | null
  }
  allocationCounts: { primary: number; fallback: number; total: number }
  primaryAgents: Array<{ id: number; name: string; status: string }>
  fallbackAgents: Array<{ id: number; name: string; status: string }>
  priority: number
  weight: number
  maxAgents?: number | null
  monthlyBudgetUsd?: number | null
  dailyTokenLimit?: number | null
  dailyRequestLimit?: number | null
  notes?: string | null
}

interface SessionPoolSnapshot {
  summary: {
    accountCount: number
    activeCount: number
    warningCount: number
    exhaustedCount: number
    cooldownCount: number
    failedCount: number
    allocatedAgentCount: number
    fallbackProtectedAgentCount: number
    recentFailoverCount: number
  }
  accounts: SessionPoolAccountView[]
  agents: Array<{
    id: number
    name: string
    role: string
    status: string
    workloadScore: number
    currentPrimaryAccountId?: number | null
    allocationChain: Array<{
      accountId: number
      label: string
      provider: string
      allocationMode: 'primary' | 'fallback'
      rank: number
      healthState: string
      suggestedModel?: string | null
    }>
  }>
  events: Array<{
    id: number
    accountId?: number | null
    accountLabel?: string | null
    agentId?: number | null
    agentName?: string | null
    eventType: string
    createdAt: number
    detail: Record<string, unknown>
  }>
}

interface SessionProviderDiscoveryProfile {
  ref: string
  label: string
  source: string
  email?: string | null
  plan?: string | null
  expiresAt?: number | null
}

interface SessionProviderDiscovery {
  codexOAuth: SessionProviderDiscoveryProfile[]
  claudeOAuth: SessionProviderDiscoveryProfile[]
  googleOAuth?: SessionProviderDiscoveryProfile[]
  directApiKeys: {
    openai: boolean
    openrouter: boolean
    anthropic: boolean
    google?: boolean
    grok?: boolean
    groq?: boolean
  }
  ollama: {
    host: string
    reachable: boolean
  }
  generatedAt: number
}

interface SessionProviderModelOption {
  id: string
  label: string
  provider: 'openai' | 'anthropic' | 'openrouter'
  source: 'live' | 'catalog'
  isFree?: boolean
  isPaid?: boolean
}

interface SessionProviderModelCatalog {
  openai: SessionProviderModelOption[]
  anthropic: SessionProviderModelOption[]
  openrouter: SessionProviderModelOption[]
  generatedAt: number
}

interface SessionAccountEditDraft {
  label: string
  provider: string
  runtimeType: string
  preferredModel: string
  reasoningEffort: string
  credentialRef: string
  monthlyBudgetUsd: string
  dailyTokenLimit: string
  dailyRequestLimit: string
  maxAgents: string
  notes: string
  enabled: boolean
}

// ── Helpers ──────────────────────────────────────────

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b']

const formatNumber = (num: number) => {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toString()
}

const formatCost = (cost: number) => '$' + cost.toFixed(4)

const getModelDisplayName = (name: string) => name.split('/').pop() || name
const currentCredentialIsEnvOpenAi = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'env:openai_api_key' || normalized === 'openai_api_key'
}
const currentCredentialIsEnvAnthropic = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'env:anthropic_api_key' || normalized === 'anthropic_api_key'
}
const currentCredentialIsEnvGoogle = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'env:google_api_key' || normalized === 'google_api_key'
}
const currentCredentialIsEnvGroq = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'env:xai_api_key' ||
    normalized === 'xai_api_key' ||
    normalized === 'env:grok_api_key' ||
    normalized === 'grok_api_key' ||
    normalized === 'env:groq_api_key' ||
    normalized === 'groq_api_key'
}

type View = 'overview' | 'agents' | 'sessions' | 'tasks'
type Timeframe = 'hour' | 'day' | 'week' | 'month'
type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

const REASONING_OPTIONS_BY_PROVIDER: Partial<Record<string, ReasoningEffort[]>> = {
  openai: ['low', 'medium', 'high', 'xhigh'],
  anthropic: ['low', 'medium', 'high'],
  google: ['low', 'medium', 'high'],
  grok: ['low', 'medium', 'high'],
  groq: ['low', 'medium', 'high'],
}

// ── Main Component ──────────────────────────────────

export function CostTrackerPanel() {
  const t = useTranslations('costTracker')
  const { sessions } = useMissionControl()

  const [view, setView] = useState<View>('overview')
  const [timeframe, setTimeframe] = useState<Timeframe>('day')
  const [chartMode, setChartMode] = useState<'incremental' | 'cumulative'>('incremental')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Data
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [byAgentData, setByAgentData] = useState<ByAgentResponse | null>(null)
  const [taskData, setTaskData] = useState<TaskCostsResponse | null>(null)
  const [sessionCosts, setSessionCosts] = useState<SessionCostEntry[]>([])
  const [sessionSort, setSessionSort] = useState<'cost' | 'tokens' | 'requests' | 'recent'>('cost')
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const timeframeToDays = (tf: Timeframe): number => {
    switch (tf) { case 'hour': case 'day': return 1; case 'week': return 7; case 'month': return 30 }
  }

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [statsRes, trendRes, byAgentRes, taskRes] = await Promise.all([
        fetch(`/api/tokens?action=stats&timeframe=${timeframe}`),
        fetch(`/api/tokens?action=trends&timeframe=${timeframe}`),
        fetch(`/api/tokens/by-agent?days=${timeframeToDays(timeframe)}`),
        fetch(`/api/tokens?action=task-costs&timeframe=${timeframe}`),
      ])
      const [statsJson, trendJson, byAgentJson, taskJson] = await Promise.all([
        statsRes.json(), trendRes.json(), byAgentRes.json(), taskRes.json(),
      ])
      setUsageStats(statsJson)
      setTrendData(trendJson)
      setByAgentData(byAgentJson)
      setTaskData(taskJson)
    } catch (err) {
      log.error('Failed to load cost data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [timeframe])

  const loadSessionCosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/tokens?action=session-costs&timeframe=${timeframe}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (Array.isArray(data?.sessions)) {
        setSessionCosts(data.sessions)
      } else if (usageStats?.sessions) {
        setSessionCosts(Object.entries(usageStats.sessions).map(([id, stats]) => ({
          sessionId: id, model: '', totalTokens: stats.totalTokens, inputTokens: 0,
          outputTokens: 0, totalCost: stats.totalCost, requestCount: stats.requestCount,
          firstSeen: '', lastSeen: '',
        })))
      }
    } catch {
      if (usageStats?.sessions) {
        setSessionCosts(Object.entries(usageStats.sessions).map(([id, stats]) => ({
          sessionId: id, model: '', totalTokens: stats.totalTokens, inputTokens: 0,
          outputTokens: 0, totalCost: stats.totalCost, requestCount: stats.requestCount,
          firstSeen: '', lastSeen: '',
        })))
      }
    }
  }, [timeframe, usageStats])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    refreshTimer.current = setInterval(loadData, 30_000)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [loadData])
  useEffect(() => { if (view === 'sessions') loadSessionCosts() }, [view, loadSessionCosts])

  const exportData = async (format: 'json' | 'csv') => {
    setIsExporting(true)
    try {
      const res = await fetch(`/api/tokens?action=export&timeframe=${timeframe}&format=${format}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'; a.href = url
      a.download = `cost-tracker-${timeframe}-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a); a.click()
      window.URL.revokeObjectURL(url); document.body.removeChild(a)
    } catch (err) {
      log.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  // Derived data
  const summary = usageStats?.summary
  const agentSummary = byAgentData?.summary
  const agentList = byAgentData?.agents || []
  const maxAgentCost = Math.max(...agentList.map(a => a.total_cost), 0.0001)

  const getAgentTasks = (agentName: string): TaskCostEntry[] => {
    if (!taskData) return []
    const entry = taskData.agents[agentName]
    if (!entry) return []
    return taskData.tasks.filter(t => entry.taskIds.includes(t.taskId))
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* View tabs */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(['overview', 'agents', 'sessions', 'tasks'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {/* Timeframe */}
            <div className="flex space-x-1">
              {(['hour', 'day', 'week', 'month'] as const).map(tf => (
                <Button key={tf} onClick={() => setTimeframe(tf)} variant={timeframe === tf ? 'default' : 'secondary'} size="sm">
                  {tf.charAt(0).toUpperCase() + tf.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isLoading && !usageStats ? (
        <Loader variant="panel" label={t('loadingCostData')} />
      ) : view === 'overview' ? (
        <OverviewView
          stats={usageStats} trendData={trendData} agentSummary={agentSummary}
          taskData={taskData} timeframe={timeframe} chartMode={chartMode}
          setChartMode={setChartMode} exportData={exportData} isExporting={isExporting}
          onRefresh={loadData}
        />
      ) : view === 'agents' ? (
        <AgentsView
          agents={agentList} summary={agentSummary} maxCost={maxAgentCost}
          expandedAgent={expandedAgent} setExpandedAgent={setExpandedAgent}
          getAgentTasks={getAgentTasks} onRefresh={loadData}
        />
      ) : view === 'sessions' ? (
        <SessionsView
          sessionCosts={sessionCosts} sessions={sessions}
          sessionSort={sessionSort} setSessionSort={setSessionSort}
        />
      ) : (
        <TasksView taskData={taskData} onRefresh={loadData} />
      )}
    </div>
  )
}

// ── Overview View ──────────────────────────────────

function OverviewView({
  stats, trendData, agentSummary, taskData, timeframe, chartMode, setChartMode,
  exportData, isExporting, onRefresh,
}: {
  stats: UsageStats | null; trendData: TrendData | null
  agentSummary: ByAgentResponse['summary'] | undefined; taskData: TaskCostsResponse | null
  timeframe: Timeframe; chartMode: 'incremental' | 'cumulative'
  setChartMode: (m: 'incremental' | 'cumulative') => void
  exportData: (f: 'json' | 'csv') => void; isExporting: boolean
  onRefresh: () => void
}) {
  const t = useTranslations('costTracker')
  if (!stats) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noUsageData')}</div>
        <div className="text-sm max-w-sm mx-auto">
          {t('noUsageDataDesc')}
        </div>
        <Button onClick={onRefresh} variant="outline" size="sm" className="mt-4 text-xs">{t('refresh')}</Button>
      </div>
    )
  }

  const modelData = Object.entries(stats.models)
    .map(([model, s]) => ({ name: getModelDisplayName(model), fullName: model, tokens: s.totalTokens, cost: s.totalCost, requests: s.requestCount }))
    .sort((a, b) => b.cost - a.cost)

  const pieData = modelData.slice(0, 6).map(m => ({ name: m.name, value: m.cost }))

  const trendChartData = (() => {
    if (!trendData?.trends) return []
    const raw = trendData.trends.map(t => ({
      time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tokens: t.tokens, cost: t.cost, requests: t.requests,
    }))
    if (chartMode === 'cumulative') {
      let ct = 0, cc = 0, cr = 0
      return raw.map(d => { ct += d.tokens; cc += d.cost; cr += d.requests; return { ...d, tokens: ct, cost: cc, requests: cr } })
    }
    return raw
  })()

  // Performance metrics
  const models = Object.entries(stats.models)
  const mostEfficient = models.length > 0
    ? models.reduce((best, curr) => {
        const c = curr[1].totalCost / Math.max(1, curr[1].totalTokens)
        const b = best[1].totalCost / Math.max(1, best[1].totalTokens)
        return c < b ? curr : best
      })
    : null
  const efficientCostPerToken = mostEfficient ? mostEfficient[1].totalCost / Math.max(1, mostEfficient[1].totalTokens) : 0
  const potentialSavings = Math.max(0, stats.summary.totalCost - stats.summary.totalTokens * efficientCostPerToken)

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(stats.summary.totalCost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCost', { timeframe })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(stats.summary.totalTokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(stats.summary.requestCount)}</div>
          <div className="text-sm text-muted-foreground">{t('apiRequests')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{agentSummary?.agent_count ?? '-'}</div>
          <div className="text-sm text-muted-foreground">{t('activeAgents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {taskData ? `${((1 - taskData.unattributed.totalCost / Math.max(stats.summary.totalCost, 0.0001)) * 100).toFixed(0)}%` : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('taskAttributed')}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Trend chart */}
        <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{t('usageTrends')}</h2>
            <div className="flex rounded-md border border-border overflow-hidden">
              {(['incremental', 'cumulative'] as const).map(m => (
                <button key={m} onClick={() => setChartMode(m)}
                  className={`px-2 py-1 text-[10px] font-medium ${chartMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                >{m === 'incremental' ? t('perTurn') : t('cumulative')}</button>
              ))}
            </div>
          </div>
          <div className="h-64">
            {trendChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noTrendData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" /><YAxis />
                  <Tooltip isAnimationActive={false} /><Legend />
                  <Line isAnimationActive={false} animationDuration={0} type="monotone" dataKey="tokens" stroke="#8884d8" strokeWidth={2} name="Tokens" />
                  <Line isAnimationActive={false} animationDuration={0} type="monotone" dataKey="requests" stroke="#82ca9d" strokeWidth={2} name="Requests" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Model bar chart */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('tokenUsageByModel')}</h2>
          <div className="h-64">
            {modelData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noModelData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} />
                  <YAxis /><Tooltip isAnimationActive={false} formatter={(v, n) => [formatNumber(Number(v)), n]} />
                  <Bar isAnimationActive={false} animationDuration={0} dataKey="tokens" fill="#8884d8" name="Tokens" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Cost pie */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('costDistributionByModel')}</h2>
          <div className="h-64">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noCostData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie isAnimationActive={false} data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={5} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip isAnimationActive={false} formatter={(v) => formatCost(Number(v))} /><Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Performance insights */}
      {models.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('performanceInsights')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('mostEfficientModel')}</div>
              <div className="text-lg font-bold text-green-500">{mostEfficient ? getModelDisplayName(mostEfficient[0]) : '-'}</div>
              {mostEfficient && <div className="text-xs text-muted-foreground">${(efficientCostPerToken * 1000).toFixed(4)}/1K tokens</div>}
            </div>
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('avgTokensPerRequest')}</div>
              <div className="text-lg font-bold text-foreground">{formatNumber(stats.summary.avgTokensPerRequest)}</div>
            </div>
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('optimizationPotential')}</div>
              <div className="text-lg font-bold text-orange-500">{formatCost(potentialSavings)}</div>
              <div className="text-xs text-muted-foreground">{stats.summary.totalCost > 0 ? ((potentialSavings / stats.summary.totalCost) * 100).toFixed(1) : '0'}% {t('savingsPossible')}</div>
            </div>
          </div>
          {/* Model efficiency bars */}
          <div className="space-y-2">
            {modelData.map(m => {
              const costPer1k = m.cost / Math.max(1, m.tokens) * 1000
              const maxCostPer1k = Math.max(...modelData.map(d => d.cost / Math.max(1, d.tokens) * 1000), 0.0001)
              return (
                <div key={m.fullName} className="flex items-center text-sm">
                  <div className="w-32 truncate text-muted-foreground">{m.name}</div>
                  <div className="flex-1 mx-3">
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: `${(costPer1k / maxCostPer1k) * 100}%` }} />
                    </div>
                  </div>
                  <div className="w-20 text-right text-xs text-muted-foreground">${costPer1k.toFixed(4)}/1K</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Export */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('exportData')}</h2>
            <p className="text-sm text-muted-foreground">{t('exportDataDesc')}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exportData('csv')} disabled={isExporting} size="sm" variant="secondary">{isExporting ? t('exporting') : 'CSV'}</Button>
            <Button onClick={() => exportData('json')} disabled={isExporting} size="sm" variant="secondary">{isExporting ? t('exporting') : 'JSON'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Agents View ──────────────────────────────────

function AgentsView({
  agents, summary, maxCost, expandedAgent, setExpandedAgent, getAgentTasks, onRefresh,
}: {
  agents: ByAgentEntry[]; summary: ByAgentResponse['summary'] | undefined
  maxCost: number; expandedAgent: string | null
  setExpandedAgent: (a: string | null) => void
  getAgentTasks: (name: string) => TaskCostEntry[]; onRefresh: () => void
}) {
  const t = useTranslations('costTracker')
  const [expandedSection, setExpandedSection] = useState<'models' | 'tasks'>('tasks')

  if (!summary || agents.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noAgentData')}</div>
        <div className="text-sm">{t('noAgentDataDesc')}</div>
        <Button onClick={onRefresh} className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary.agent_count}</div>
          <div className="text-sm text-muted-foreground">{t('agents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(summary.total_cost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCostDays', { days: summary.days })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(summary.total_tokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {summary.total_tokens > 0 ? `$${(summary.total_cost / summary.total_tokens * 1000).toFixed(4)}` : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('avgPer1kTokens')}</div>
        </div>
      </div>

      {/* Cost bar chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('perAgentCost')}</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agents.slice(0, 12).map(a => ({
              name: a.agent.length > 12 ? a.agent.slice(0, 11) + '\u2026' : a.agent,
              cost: Number(a.total_cost.toFixed(4)),
            }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
              <Tooltip isAnimationActive={false} formatter={(v) => formatCost(Number(v))} />
              <Bar isAnimationActive={false} animationDuration={0} dataKey="cost" fill="#0088FE" name="Cost ($)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent detail rows */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('agentBreakdown')}</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {agents.map(agent => {
            const costShare = (agent.total_cost / Math.max(summary.total_cost, 0.0001)) * 100
            const isExpanded = expandedAgent === agent.agent
            const agentTasks = getAgentTasks(agent.agent)
            return (
              <div key={agent.agent} className="border border-border rounded-lg overflow-hidden">
                <Button onClick={() => setExpandedAgent(isExpanded ? null : agent.agent)}
                  variant="ghost" className="w-full p-4 h-auto flex items-center justify-between text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-foreground truncate">{agent.agent}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                      {agent.session_count} session{agent.session_count !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
                      {agent.request_count} req{agent.request_count !== 1 ? 's' : ''}
                    </span>
                    {agentTasks.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 shrink-0">
                        {agentTasks.length} task{agentTasks.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <div className="w-24 hidden md:block">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(agent.total_cost / maxCost) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-foreground">{formatCost(agent.total_cost)}</div>
                      <div className="text-xs text-muted-foreground">{costShare.toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">{formatNumber(agent.total_tokens)}</div>
                      <div className="text-xs text-muted-foreground">{t('tokens')}</div>
                    </div>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <polyline points="4,6 8,10 12,6" />
                    </svg>
                  </div>
                </Button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border bg-secondary/30">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 mb-3">
                      <div><div className="text-xs text-muted-foreground">{t('inputTokens')}</div><div className="text-sm font-medium">{formatNumber(agent.total_input_tokens)}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('outputTokens')}</div><div className="text-sm font-medium">{formatNumber(agent.total_output_tokens)}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('ioRatio')}</div><div className="text-sm font-medium">{agent.total_output_tokens > 0 ? (agent.total_input_tokens / agent.total_output_tokens).toFixed(2) : '-'}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('lastActive')}</div><div className="text-sm font-medium">{new Date(agent.last_active).toLocaleDateString()}</div></div>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <Button variant={expandedSection === 'tasks' ? 'default' : 'ghost'} size="sm" onClick={(e) => { e.stopPropagation(); setExpandedSection('tasks') }}>Tasks ({agentTasks.length})</Button>
                      <Button variant={expandedSection === 'models' ? 'default' : 'ghost'} size="sm" onClick={(e) => { e.stopPropagation(); setExpandedSection('models') }}>Models ({agent.models.length})</Button>
                    </div>

                    {expandedSection === 'tasks' && (
                      <div className="text-sm">
                        {agentTasks.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic py-2">{t('noTaskCosts')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {agentTasks.map(task => (
                              <div key={task.taskId} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    task.priority === 'critical' ? 'bg-red-500/10 text-red-500' :
                                    task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' :
                                    task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                                    'bg-secondary text-muted-foreground'
                                  }`}>{task.priority}</span>
                                  {task.project.ticketRef && <span className="text-muted-foreground font-mono">{task.project.ticketRef}</span>}
                                  <span className="text-foreground truncate">{task.title}</span>
                                </div>
                                <span className="font-medium text-foreground w-16 text-right shrink-0">{formatCost(task.stats.totalCost)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {expandedSection === 'models' && agent.models.length > 0 && (
                      <div className="space-y-1.5">
                        {agent.models.map(m => (
                          <div key={m.model} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate">{getModelDisplayName(m.model)}</span>
                            <div className="flex gap-4 shrink-0">
                              <span>{formatNumber(m.input_tokens)} in</span>
                              <span>{formatNumber(m.output_tokens)} out</span>
                              <span>{m.request_count} reqs</span>
                              <span className="font-medium text-foreground w-16 text-right">{formatCost(m.cost)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Sessions View ──────────────────────────────────

function SessionsView({
  sessionCosts, sessions, sessionSort, setSessionSort,
}: {
  sessionCosts: SessionCostEntry[]; sessions: any[]
  sessionSort: 'cost' | 'tokens' | 'requests' | 'recent'
  setSessionSort: (s: 'cost' | 'tokens' | 'requests' | 'recent') => void
}) {
  const t = useTranslations('costTracker')
  const [poolSnapshot, setPoolSnapshot] = useState<SessionPoolSnapshot | null>(null)
  const [providerDiscovery, setProviderDiscovery] = useState<SessionProviderDiscovery | null>(null)
  const [providerModels, setProviderModels] = useState<SessionProviderModelCatalog | null>(null)
  const [poolLoading, setPoolLoading] = useState(false)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const [accountSearch, setAccountSearch] = useState('')
  const [accountHealthFilter, setAccountHealthFilter] = useState<'all' | 'healthy' | 'warning' | 'issues'>('all')
  const [sessionSearch, setSessionSearch] = useState('')
  const [showAllAccounts, setShowAllAccounts] = useState(false)
  const [accountDetailHidden, setAccountDetailHidden] = useState<Record<number, boolean>>({})
  const [expandedAgentBadges, setExpandedAgentBadges] = useState<Record<string, boolean>>({})
  const [providerSetupMinimized, setProviderSetupMinimized] = useState(false)
  const [addAccountMinimized, setAddAccountMinimized] = useState(false)
  const [codexAuthMode, setCodexAuthMode] = useState<'oauth' | 'api'>('oauth')
  const [codexOauthEmail, setCodexOauthEmail] = useState('')
  const [codexOauthBusy, setCodexOauthBusy] = useState(false)
  const [codexOauthError, setCodexOauthError] = useState<string | null>(null)
  const [codexOauthOutput, setCodexOauthOutput] = useState<string | null>(null)
  const [codexOauthCode, setCodexOauthCode] = useState<string | null>(null)
  const [codexOauthUrl, setCodexOauthUrl] = useState<string | null>(null)
  const [codexApiKey, setCodexApiKey] = useState('')
  const [anthropicAuthMode, setAnthropicAuthMode] = useState<'oauth' | 'api'>('oauth')
  const [anthropicOauthEmail, setAnthropicOauthEmail] = useState('')
  const [anthropicOauthBusy, setAnthropicOauthBusy] = useState(false)
  const [anthropicOauthError, setAnthropicOauthError] = useState<string | null>(null)
  const [anthropicOauthOutput, setAnthropicOauthOutput] = useState<string | null>(null)
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [googleAuthMode, setGoogleAuthMode] = useState<'oauth' | 'api'>('oauth')
  const [googleOauthBusy, setGoogleOauthBusy] = useState(false)
  const [googleOauthError, setGoogleOauthError] = useState<string | null>(null)
  const [googleOauthOutput, setGoogleOauthOutput] = useState<string | null>(null)
  const [googleApiKey, setGoogleApiKey] = useState('')
  const [groqAuthMode, setGroqAuthMode] = useState<'oauth' | 'api'>('api')
  const [groqOauthBusy, setGroqOauthBusy] = useState(false)
  const [groqOauthError, setGroqOauthError] = useState<string | null>(null)
  const [groqOauthOutput, setGroqOauthOutput] = useState<string | null>(null)
  const [groqApiKey, setGroqApiKey] = useState('')
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null)
  const [accountEditDraft, setAccountEditDraft] = useState<SessionAccountEditDraft | null>(null)
  const [openRouterModelFilters, setOpenRouterModelFilters] = useState({ free: true, paid: true })
  const [eventsExpanded, setEventsExpanded] = useState(false)
  const [mappingsExpanded, setMappingsExpanded] = useState(false)
  const [form, setForm] = useState({
    label: '',
    provider: 'openai',
    runtimeType: 'codex',
    preferredModel: '',
    reasoningEffort: '',
    credentialRef: '',
    monthlyBudgetUsd: '',
    dailyTokenLimit: '',
    dailyRequestLimit: '',
    maxAgents: '',
    notes: '',
  })

  const runtimeDefaultByProvider: Record<string, string> = {
    openai: 'codex',
    anthropic: 'claude',
    openrouter: 'openrouter',
    ollama: 'local',
    google: 'custom',
    grok: 'custom',
    groq: 'custom',
  }

  const defaultModelByProvider: Record<string, string> = {
    openai: 'openai/codex-mini-latest',
    anthropic: 'anthropic/claude-sonnet-4-6',
    openrouter: 'openrouter/google/gemini-2.5-flash',
    ollama: 'ollama/qwen2.5-coder:14b',
    grok: 'grok/grok-3-mini',
  }

  const isCodexAccountForm = form.provider === 'openai' && form.runtimeType === 'codex'
  const isAnthropicAccountForm = form.provider === 'anthropic' && form.runtimeType === 'claude'
  const isGoogleAccountForm = form.provider === 'google'
  const isGroqAccountForm = form.provider === 'grok' || form.provider === 'groq'
  const formReasoningOptions = REASONING_OPTIONS_BY_PROVIDER[form.provider] || []
  const supportsReasoningEffort = formReasoningOptions.length > 0

  const getProviderModelOptions = (provider: string): SessionProviderModelOption[] => {
    if (!providerModels) return []
    if (provider === 'openai') return providerModels.openai || []
    if (provider === 'anthropic') return providerModels.anthropic || []
    if (provider === 'openrouter') return providerModels.openrouter || []
    return []
  }

  const getDefaultModelForProvider = (provider: string): string => {
    const providerOptions = getProviderModelOptions(provider)
    if (provider === 'openrouter') {
      const preferred = providerOptions.find((option) => option.isFree)
      if (preferred?.id) return preferred.id
    }
    if (providerOptions[0]?.id) return providerOptions[0].id
    return defaultModelByProvider[provider] || ''
  }

  const loadPool = useCallback(async (options?: { force?: boolean; discovery?: boolean; models?: boolean }) => {
    setPoolLoading(true)
    setPoolError(null)
    try {
      const params = new URLSearchParams()
      if (options?.force) params.set('force', 'true')
      if (options?.discovery) params.set('discovery', 'true')
      if (options?.models) params.set('models', 'true')
      const query = params.toString()
      const res = await fetch(`/api/session-pool${query ? `?${query}` : ''}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setPoolSnapshot(data)
      if (data?.discovery) setProviderDiscovery(data.discovery as SessionProviderDiscovery)
      if (data?.modelOptions) setProviderModels(data.modelOptions as SessionProviderModelCatalog)
    } catch (err) {
      log.error('Failed to load session pool:', err)
      setPoolError('__load__')
    } finally {
      setPoolLoading(false)
    }
  }, [])

  useEffect(() => { loadPool({ discovery: true, models: true }) }, [loadPool])

  const mutatePool = async (method: 'POST' | 'PUT' | 'DELETE', url: string, body?: Record<string, unknown>) => {
    setIsMutating(true)
    setPoolError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      if (data?.snapshot) setPoolSnapshot(data.snapshot)
      else await loadPool({ discovery: true, models: true })
      return true
    } catch (err) {
      log.error('Session pool mutation failed:', err)
      setPoolError(err instanceof Error ? err.message : '__mutate__')
      return false
    } finally {
      setIsMutating(false)
    }
  }

  const toCredentialSuffix = (value: string) => {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    return normalized || 'default'
  }

  const buildCodexCredentialRef = (input: {
    baseRef: string
    label: string
    email: string
  }) => {
    const baseRef = String(input.baseRef || '').trim()
    if (!baseRef.startsWith('codex-auth:desktop')) return baseRef
    const suffix = toCredentialSuffix(input.label || input.email || 'default')
    return `codex-auth:desktop:${suffix}`
  }

  const handleCreateAccount = async (event: any) => {
    event.preventDefault()
    setPoolError(null)
    const providerDefaultModel = getDefaultModelForProvider(form.provider)
    const createPayload: Record<string, unknown> = {
      action: 'create',
      ...form,
      preferredModel: form.preferredModel || providerDefaultModel || null,
      reasoningEffort: form.reasoningEffort || null,
      monthlyBudgetUsd: form.monthlyBudgetUsd || null,
      dailyTokenLimit: form.dailyTokenLimit || null,
      dailyRequestLimit: form.dailyRequestLimit || null,
      maxAgents: form.maxAgents || null,
    }

    if (isCodexAccountForm) {
      if (codexAuthMode === 'api') {
        if (!codexApiKey.trim()) {
          setPoolError('Provide OpenAI API key before saving this Codex account.')
          return
        }
        try {
          const res = await fetch('/api/integrations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vars: { OPENAI_API_KEY: codexApiKey.trim() } }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`)
          }
          createPayload.credentialRef = 'env:OPENAI_API_KEY'
        } catch (err) {
          setPoolError(err instanceof Error ? err.message : 'Failed to store OpenAI API key')
          return
        }
      } else {
        const candidateRef = String(createPayload.credentialRef || '').trim()
        if (!candidateRef.startsWith('codex-auth:')) {
          setPoolError('Connect Codex OAuth first, then save the account.')
          return
        }
        createPayload.credentialRef = buildCodexCredentialRef({
          baseRef: candidateRef,
          label: String(createPayload.label || form.label || ''),
          email: codexOauthEmail,
        })
      }
    }

    if (isAnthropicAccountForm) {
      if (anthropicAuthMode === 'api') {
        if (!anthropicApiKey.trim()) {
          setPoolError('Provide Anthropic API key before saving this Claude account.')
          return
        }
        try {
          const res = await fetch('/api/integrations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vars: { ANTHROPIC_API_KEY: anthropicApiKey.trim() } }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`)
          }
          createPayload.credentialRef = 'env:ANTHROPIC_API_KEY'
        } catch (err) {
          setPoolError(err instanceof Error ? err.message : 'Failed to store Anthropic API key')
          return
        }
      } else {
        const candidateRef = String(createPayload.credentialRef || '').trim()
        if (!candidateRef.startsWith('claude-auth:')) {
          setPoolError('Connect Claude OAuth first, then save the account.')
          return
        }
      }
    }

    if (isGoogleAccountForm) {
      if (googleAuthMode === 'api') {
        if (!googleApiKey.trim()) {
          setPoolError('Provide Google API key before saving this Gemini account.')
          return
        }
        try {
          const res = await fetch('/api/integrations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vars: { GOOGLE_API_KEY: googleApiKey.trim() } }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`)
          }
          createPayload.credentialRef = 'env:GOOGLE_API_KEY'
        } catch (err) {
          setPoolError(err instanceof Error ? err.message : 'Failed to store Google API key')
          return
        }
      } else {
        const candidateRef = String(createPayload.credentialRef || '').trim()
        if (!candidateRef.startsWith('google-auth:')) {
          setPoolError('Connect Google OAuth first, then save the account.')
          return
        }
      }
    }

    if (isGroqAccountForm) {
      createPayload.provider = 'grok'
      if (groqAuthMode === 'api') {
        if (!groqApiKey.trim()) {
          setPoolError('Provide Grok (xAI) API key before saving this Grok account.')
          return
        }
        try {
          const res = await fetch('/api/integrations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vars: { XAI_API_KEY: groqApiKey.trim() } }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`)
          }
          createPayload.credentialRef = 'env:XAI_API_KEY'
        } catch (err) {
          setPoolError(err instanceof Error ? err.message : 'Failed to store Grok API key')
          return
        }
      } else {
        setPoolError('Grok OAuth opens xAI console only. Create an API key there, then switch to API Key mode before saving this account.')
        return
      }
    }

    await mutatePool('POST', '/api/session-pool', {
      ...createPayload,
    })
    setForm({
      label: '',
      provider: form.provider,
      runtimeType: form.runtimeType,
      preferredModel: providerDefaultModel,
      reasoningEffort: '',
      credentialRef: '',
      monthlyBudgetUsd: '',
      dailyTokenLimit: '',
      dailyRequestLimit: '',
      maxAgents: '',
      notes: '',
    })
    setCodexApiKey('')
    setAnthropicApiKey('')
    setGoogleApiKey('')
    setGroqApiKey('')
  }

  const handleProviderChange = (provider: string) => {
    const nextModel = getDefaultModelForProvider(provider)
    const nextRuntime = runtimeDefaultByProvider[provider] || form.runtimeType
    const nextReasoningOptions = REASONING_OPTIONS_BY_PROVIDER[provider] || []
    setForm((current) => ({
      ...current,
      ...(() => {
        let nextCredentialRef = current.credentialRef
        if (provider === 'openai' && nextRuntime === 'codex') {
          if (codexAuthMode === 'api') nextCredentialRef = 'env:OPENAI_API_KEY'
          else if (!String(nextCredentialRef || '').trim().startsWith('codex-auth:')) nextCredentialRef = ''
        }
        if (provider === 'anthropic' && nextRuntime === 'claude') {
          if (anthropicAuthMode === 'api') nextCredentialRef = 'env:ANTHROPIC_API_KEY'
          else if (!String(nextCredentialRef || '').trim().startsWith('claude-auth:')) nextCredentialRef = ''
        }
        if (provider === 'google') {
          if (googleAuthMode === 'api') nextCredentialRef = 'env:GOOGLE_API_KEY'
          else if (!String(nextCredentialRef || '').trim().startsWith('google-auth:')) nextCredentialRef = ''
        }
        if (provider === 'grok' || provider === 'groq') {
          if (groqAuthMode === 'api') nextCredentialRef = 'env:XAI_API_KEY'
          else if (!String(nextCredentialRef || '').trim().startsWith('grok-auth:')) nextCredentialRef = ''
        }
        return { credentialRef: nextCredentialRef }
      })(),
      provider,
      runtimeType: nextRuntime,
      preferredModel: nextModel || current.preferredModel,
      reasoningEffort: nextReasoningOptions.includes(current.reasoningEffort as ReasoningEffort)
        ? current.reasoningEffort
        : '',
    }))
  }

  const addDetectedAccount = async (options: {
    label: string
    provider: string
    runtimeType: string
    preferredModel: string
    credentialRef: string
    notes: string
  }) => {
    const ok = await mutatePool('POST', '/api/session-pool', {
      action: 'create',
      label: options.label,
      provider: options.provider,
      runtimeType: options.runtimeType,
      preferredModel: options.preferredModel,
      credentialRef: options.credentialRef,
      monthlyBudgetUsd: null,
      dailyTokenLimit: null,
      dailyRequestLimit: null,
      maxAgents: null,
      notes: options.notes,
    })
    if (ok) await loadPool({ discovery: true, models: true })
  }

  const credentialRefs = new Set(
    (poolSnapshot?.accounts || [])
      .map((account) => String(account.credentialRef || '').trim())
      .filter(Boolean),
  )

  const providerHint = (() => {
    switch (form.provider) {
      case 'openai':
        return t('providerHintOpenai')
      case 'anthropic':
        return t('providerHintAnthropic')
      case 'openrouter':
        return t('providerHintOpenrouter')
      case 'ollama':
        return t('providerHintOllama')
      case 'google':
        return t('providerHintGoogle')
      case 'grok':
      case 'groq':
        return t('providerHintGrok')
      default:
        return t('providerHintDefault')
    }
  })()

  const applyFormPreset = (provider: 'openai' | 'anthropic' | 'openrouter' | 'ollama' | 'google' | 'grok') => {
    const runtimeByProvider: Record<typeof provider, string> = {
      openai: 'codex',
      anthropic: 'claude',
      openrouter: 'openrouter',
      ollama: 'local',
      google: 'custom',
      grok: 'custom',
    }
    const refByProvider: Record<typeof provider, string> = {
      openai: codexAuthMode === 'api' ? 'env:OPENAI_API_KEY' : '',
      anthropic: anthropicAuthMode === 'api' ? 'env:ANTHROPIC_API_KEY' : '',
      openrouter: 'env:OPENROUTER_API_KEY',
      ollama: 'OLLAMA_HOST',
      google: googleAuthMode === 'api' ? 'env:GOOGLE_API_KEY' : '',
      grok: groqAuthMode === 'api' ? 'env:XAI_API_KEY' : '',
    }
    setForm((current) => ({
      ...current,
      provider,
      runtimeType: runtimeByProvider[provider],
      preferredModel: getDefaultModelForProvider(provider) || current.preferredModel,
      reasoningEffort: '',
      credentialRef: refByProvider[provider],
    }))
  }

  const beginAccountEdit = (account: SessionPoolAccountView) => {
    setEditingAccountId(account.id)
    setAccountEditDraft({
      label: account.label || '',
      provider: account.provider || 'openai',
      runtimeType: account.runtimeType || '',
      preferredModel: account.preferredModel || '',
      reasoningEffort: typeof account.metadata?.reasoningEffort === 'string' ? account.metadata.reasoningEffort : '',
      credentialRef: account.credentialRef || '',
      monthlyBudgetUsd: account.monthlyBudgetUsd != null ? String(account.monthlyBudgetUsd) : '',
      dailyTokenLimit: account.dailyTokenLimit != null ? String(account.dailyTokenLimit) : '',
      dailyRequestLimit: account.dailyRequestLimit != null ? String(account.dailyRequestLimit) : '',
      maxAgents: account.maxAgents != null ? String(account.maxAgents) : '',
      notes: account.notes || '',
      enabled: account.enabled,
    })
  }

  const cancelAccountEdit = () => {
    setEditingAccountId(null)
    setAccountEditDraft(null)
  }

  const saveAccountEdit = async (accountId: number) => {
    if (!accountEditDraft) return
    const ok = await mutatePool('PUT', '/api/session-pool', {
      accountId,
      label: accountEditDraft.label,
      provider: accountEditDraft.provider,
      runtimeType: accountEditDraft.runtimeType || null,
      preferredModel: accountEditDraft.preferredModel || null,
      reasoningEffort: accountEditDraft.reasoningEffort || null,
      credentialRef: accountEditDraft.credentialRef || null,
      monthlyBudgetUsd: accountEditDraft.monthlyBudgetUsd || null,
      dailyTokenLimit: accountEditDraft.dailyTokenLimit || null,
      dailyRequestLimit: accountEditDraft.dailyRequestLimit || null,
      maxAgents: accountEditDraft.maxAgents || null,
      notes: accountEditDraft.notes || null,
      enabled: accountEditDraft.enabled,
    })
    if (ok) cancelAccountEdit()
  }

  const connectCodexOAuth = async () => {
    setCodexOauthBusy(true)
    setCodexOauthError(null)
    setCodexOauthOutput(null)
    setCodexOauthCode(null)
    setCodexOauthUrl(null)

    try {
      const response = await fetch('/api/session-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-codex-oauth',
          email: codexOauthEmail.trim() || null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || `OAuth failed (${response.status})`))
      }

      if (typeof data?.message === 'string' && data.message.trim()) {
        setCodexOauthOutput(data.message)
      }
      if (typeof data?.oauthUrl === 'string' && data.oauthUrl.trim()) {
        setCodexOauthUrl(data.oauthUrl)
        try {
          window.open(data.oauthUrl, '_blank', 'noopener,noreferrer')
        } catch {}
      } else {
        setCodexOauthUrl(null)
      }

      if (data?.matchedProfile?.ref && !data?.launched) {
        const profile = data.matchedProfile
        setForm((current) => ({
          ...current,
          ...(() => {
            const nextCredentialRef = buildCodexCredentialRef({
              baseRef: profile.ref,
              label: current.label,
              email: codexOauthEmail,
            })
            return { credentialRef: nextCredentialRef }
          })(),
          provider: 'openai',
          runtimeType: 'codex',
          label: current.label || profile.label || `Codex OAuth (${profile.email || 'account'})`,
        }))
        setCodexOauthBusy(false)
        return
      }

      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      let refreshedData: any = null
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (attempt > 0) await wait(1500)
        const refreshed = await fetch('/api/session-pool?discovery=true&models=true')
        if (!refreshed.ok) continue
        refreshedData = await refreshed.json().catch(() => ({}))
        if (refreshedData?.discovery || refreshedData?.modelOptions) {
          setPoolSnapshot(refreshedData)
          if (refreshedData.discovery) setProviderDiscovery(refreshedData.discovery as SessionProviderDiscovery)
          if (refreshedData.modelOptions) setProviderModels(refreshedData.modelOptions as SessionProviderModelCatalog)
        }
        const profiles = (refreshedData?.discovery?.codexOAuth || []) as SessionProviderDiscoveryProfile[]
        const requestedEmail = codexOauthEmail.trim().toLowerCase()
        const selectedProfile = profiles.find((profile) => (
          requestedEmail &&
          typeof profile.email === 'string' &&
          profile.email.toLowerCase() === requestedEmail
        )) || profiles[0]
        if (selectedProfile?.ref) {
          setForm((current) => ({
            ...current,
            ...(() => {
              const nextCredentialRef = buildCodexCredentialRef({
                baseRef: selectedProfile.ref,
                label: current.label,
                email: codexOauthEmail,
              })
              return { credentialRef: nextCredentialRef }
            })(),
            provider: 'openai',
            runtimeType: 'codex',
            label: current.label || selectedProfile.label || `Codex OAuth (${selectedProfile.email || requestedEmail || 'account'})`,
          }))
          return
        }
      }

      if (!refreshedData?.discovery?.codexOAuth?.length) {
        setCodexOauthOutput((current) => current
          ? `${current}\nWaiting for a new Codex OAuth profile. Finish the login flow in Codex Desktop, then click Refresh Setup Status if needed.`
          : 'Waiting for a new Codex OAuth profile. Finish the login flow in Codex Desktop, then click Refresh Setup Status if needed.')
      }
    } catch (err) {
      setCodexOauthError(err instanceof Error ? err.message : 'Codex OAuth failed')
    } finally {
      setCodexOauthBusy(false)
    }
  }

  const connectAnthropicOAuth = async () => {
    setAnthropicOauthBusy(true)
    setAnthropicOauthError(null)
    setAnthropicOauthOutput(null)

    try {
      const response = await fetch('/api/session-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-claude-oauth',
          email: anthropicOauthEmail.trim() || null,
          forceLaunch: true,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || `OAuth failed (${response.status})`))
      }

      if (typeof data?.message === 'string' && data.message.trim()) {
        setAnthropicOauthOutput(data.message)
      }
      if (typeof data?.oauthUrl === 'string' && data.oauthUrl.trim()) {
        try {
          window.open(data.oauthUrl, '_blank', 'noopener,noreferrer')
        } catch {}
      }

      if (data?.matchedProfile?.ref && !data?.launched) {
        const profile = data.matchedProfile
        setForm((current) => ({
          ...current,
          provider: 'anthropic',
          runtimeType: 'claude',
          credentialRef: profile.ref,
          label: current.label || profile.label || `Claude OAuth (${profile.email || 'account'})`,
        }))
        return
      }

      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      let refreshedData: any = null
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (attempt > 0) await wait(1500)
        const refreshed = await fetch('/api/session-pool?discovery=true&models=true')
        if (!refreshed.ok) continue
        refreshedData = await refreshed.json().catch(() => ({}))
        if (refreshedData?.discovery || refreshedData?.modelOptions) {
          setPoolSnapshot(refreshedData)
          if (refreshedData.discovery) setProviderDiscovery(refreshedData.discovery as SessionProviderDiscovery)
          if (refreshedData.modelOptions) setProviderModels(refreshedData.modelOptions as SessionProviderModelCatalog)
        }
        const profiles = (refreshedData?.discovery?.claudeOAuth || []) as SessionProviderDiscoveryProfile[]
        const requestedEmail = anthropicOauthEmail.trim().toLowerCase()
        const selectedProfile = profiles.find((profile) => (
          requestedEmail &&
          typeof profile.email === 'string' &&
          profile.email.toLowerCase() === requestedEmail
        )) || profiles[0]
        if (selectedProfile?.ref) {
          setForm((current) => ({
            ...current,
            provider: 'anthropic',
            runtimeType: 'claude',
            credentialRef: selectedProfile.ref,
            label: current.label || selectedProfile.label || `Claude OAuth (${selectedProfile.email || requestedEmail || 'account'})`,
          }))
          return
        }
      }

      if (!refreshedData?.discovery?.claudeOAuth?.length) {
        setAnthropicOauthOutput((current) => current
          ? `${current}\nWaiting for a new Claude OAuth profile. Finish the login flow in Claude Desktop, then click Refresh Setup Status if needed.`
          : 'Waiting for a new Claude OAuth profile. Finish the login flow in Claude Desktop, then click Refresh Setup Status if needed.')
      }
    } catch (err) {
      setAnthropicOauthError(err instanceof Error ? err.message : 'Claude OAuth failed')
    } finally {
      setAnthropicOauthBusy(false)
    }
  }

  const connectGoogleOAuth = async () => {
    setGoogleOauthBusy(true)
    setGoogleOauthError(null)
    setGoogleOauthOutput(null)
    try {
      const response = await fetch('/api/session-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-google-oauth',
          forceLaunch: true,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || `OAuth failed (${response.status})`))
      }
      if (typeof data?.message === 'string' && data.message.trim()) {
        setGoogleOauthOutput(data.message)
      }
      if (typeof data?.oauthUrl === 'string' && data.oauthUrl.trim()) {
        try {
          window.open(data.oauthUrl, '_blank', 'noopener,noreferrer')
        } catch {}
      }
      if (data?.matchedProfile?.ref) {
        const profile = data.matchedProfile
        setForm((current) => ({
          ...current,
          provider: 'google',
          runtimeType: 'custom',
          credentialRef: String(profile.ref),
          label: current.label || profile.label || `Google OAuth (${profile.email || 'account'})`,
        }))
      } else {
        setForm((current) => ({
          ...current,
          provider: 'google',
          runtimeType: 'custom',
          credentialRef: current.credentialRef || 'google-auth:gcloud:default',
        }))
      }
      await loadPool({ discovery: true, models: true })
    } catch (err) {
      setGoogleOauthError(err instanceof Error ? err.message : 'Google OAuth failed')
    } finally {
      setGoogleOauthBusy(false)
    }
  }

  const connectGroqOAuth = async () => {
    setGroqOauthBusy(true)
    setGroqOauthError(null)
    setGroqOauthOutput(null)
    try {
      const response = await fetch('/api/session-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start-grok-oauth',
          forceLaunch: true,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || `OAuth failed (${response.status})`))
      }
      if (typeof data?.message === 'string' && data.message.trim()) {
        setGroqOauthOutput(data.message)
      }
      if (typeof data?.oauthUrl === 'string' && data.oauthUrl.trim()) {
        try {
          window.open(data.oauthUrl, '_blank', 'noopener,noreferrer')
        } catch {}
      }
      setForm((current) => ({
        ...current,
        provider: 'grok',
        runtimeType: 'custom',
        credentialRef: current.credentialRef || 'grok-auth:portal',
      }))
    } catch (err) {
      setGroqOauthError(err instanceof Error ? err.message : 'Grok portal launch failed')
    } finally {
      setGroqOauthBusy(false)
    }
  }

  const healthTone = (state: string) => {
    switch (state) {
      case 'healthy': return 'bg-green-500/10 text-green-500 border-green-500/20'
      case 'warning': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
      case 'exhausted': return 'bg-orange-500/10 text-orange-500 border-orange-500/20'
      case 'cooldown': return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      case 'failed': return 'bg-red-500/10 text-red-500 border-red-500/20'
      default: return 'bg-secondary text-muted-foreground border-border'
    }
  }

  const filterByHealth = (state: string) => {
    if (accountHealthFilter === 'all') return true
    if (accountHealthFilter === 'healthy') return state === 'healthy'
    if (accountHealthFilter === 'warning') return state === 'warning'
    return state === 'failed' || state === 'cooldown' || state === 'exhausted' || state === 'disabled'
  }

  const filteredAccounts = (poolSnapshot?.accounts || []).filter((account) => {
    const matchesSearch =
      !accountSearch.trim() ||
      account.label.toLowerCase().includes(accountSearch.toLowerCase()) ||
      account.provider.toLowerCase().includes(accountSearch.toLowerCase()) ||
      String(account.credentialRef || '').toLowerCase().includes(accountSearch.toLowerCase())
    return matchesSearch && filterByHealth(account.health.state)
  })
  const visibleAccounts = showAllAccounts ? filteredAccounts : filteredAccounts.slice(0, 6)
  const hiddenAccountCount = Math.max(0, filteredAccounts.length - visibleAccounts.length)

  const toggleAccountDetails = (accountId: number) => {
    setAccountDetailHidden((current) => ({
      ...current,
      [accountId]: !current[accountId],
    }))
  }

  const setAllAccountDetails = (hidden: boolean) => {
    const next: Record<number, boolean> = {}
    for (const account of filteredAccounts) next[account.id] = hidden
    setAccountDetailHidden(next)
  }

  const getVisibleAgentBadges = (key: string, agents: Array<{ id: number; name: string; status: string }>) => {
    const expanded = Boolean(expandedAgentBadges[key])
    return {
      expanded,
      items: expanded ? agents : agents.slice(0, 6),
      hiddenCount: Math.max(0, agents.length - (expanded ? agents.length : 6)),
    }
  }

  const poolErrorText = poolError === '__load__'
    ? t('sessionPoolLoadFailed')
    : poolError === '__mutate__'
      ? t('sessionPoolMutationFailed')
      : poolError

  const sessionEvents = poolSnapshot?.events || []
  const visibleEvents = eventsExpanded ? sessionEvents.slice(0, 36) : sessionEvents.slice(0, 10)
  const mappedAgents = poolSnapshot?.agents || []
  const visibleMappings = mappingsExpanded ? mappedAgents.slice(0, 48) : mappedAgents.slice(0, 12)

  const sorted = [...sessionCosts]
    .filter((entry) => {
      if (!sessionSearch.trim()) return true
      const query = sessionSearch.toLowerCase()
      const sessionInfo = sessions.find((s: any) => s.id === entry.sessionId)
      const candidate = `${entry.sessionId} ${entry.sessionKey || ''} ${entry.model || ''} ${sessionInfo?.key || ''}`
      return candidate.toLowerCase().includes(query)
    })
    .sort((a, b) => {
    switch (sessionSort) {
      case 'cost': return b.totalCost - a.totalCost
      case 'tokens': return b.totalTokens - a.totalTokens
      case 'requests': return b.requestCount - a.requestCount
      case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
      default: return 0
    }
  })

  const supportsProviderModelDropdown =
    form.provider === 'openai' || form.provider === 'anthropic' || form.provider === 'openrouter'
  const providerModelOptions = getProviderModelOptions(form.provider)
  const filteredProviderModelOptions = providerModelOptions.filter((option) => {
    if (form.provider !== 'openrouter') return true
    const isFree = Boolean(option.isFree)
    const isPaid = option.isPaid != null ? Boolean(option.isPaid) : !isFree
    return (openRouterModelFilters.free && isFree) || (openRouterModelFilters.paid && isPaid)
  })
  const providerModelSource = providerModelOptions[0]?.source || 'catalog'

  useEffect(() => {
    if (!supportsProviderModelDropdown) return
    if (form.preferredModel) return
    if (!filteredProviderModelOptions.length) return
    setForm((current) => (
      current.preferredModel
        ? current
        : { ...current, preferredModel: filteredProviderModelOptions[0].id }
    ))
  }, [
    supportsProviderModelDropdown,
    form.preferredModel,
    filteredProviderModelOptions,
  ])

  useEffect(() => {
    if (!isCodexAccountForm) return
    if (codexAuthMode === 'api') {
      if (currentCredentialIsEnvOpenAi(form.credentialRef)) return
      setForm((current) => ({
        ...current,
        credentialRef: 'env:OPENAI_API_KEY',
      }))
    } else if (codexAuthMode === 'oauth' && currentCredentialIsEnvOpenAi(form.credentialRef)) {
      setForm((current) => ({
        ...current,
        credentialRef: '',
      }))
    }
  }, [codexAuthMode, isCodexAccountForm, form.credentialRef])

  useEffect(() => {
    if (!isCodexAccountForm) return
    setCodexOauthError(null)
    setCodexOauthOutput(null)
    setCodexOauthCode(null)
    setCodexOauthUrl(null)
  }, [codexAuthMode, isCodexAccountForm])

  useEffect(() => {
    if (!isAnthropicAccountForm) return
    if (anthropicAuthMode === 'api') {
      if (currentCredentialIsEnvAnthropic(form.credentialRef)) return
      setForm((current) => ({
        ...current,
        credentialRef: 'env:ANTHROPIC_API_KEY',
      }))
    } else if (anthropicAuthMode === 'oauth' && currentCredentialIsEnvAnthropic(form.credentialRef)) {
      setForm((current) => ({
        ...current,
        credentialRef: '',
      }))
    }
  }, [anthropicAuthMode, isAnthropicAccountForm, form.credentialRef])

  useEffect(() => {
    if (!isAnthropicAccountForm) return
    setAnthropicOauthError(null)
    setAnthropicOauthOutput(null)
  }, [anthropicAuthMode, isAnthropicAccountForm])

  useEffect(() => {
    if (!isGoogleAccountForm) return
    if (googleAuthMode === 'api') {
      if (currentCredentialIsEnvGoogle(form.credentialRef)) return
      setForm((current) => ({
        ...current,
        credentialRef: 'env:GOOGLE_API_KEY',
      }))
    } else if (googleAuthMode === 'oauth' && currentCredentialIsEnvGoogle(form.credentialRef)) {
      setForm((current) => ({
        ...current,
        credentialRef: 'google-auth:gcloud:default',
      }))
    }
  }, [googleAuthMode, isGoogleAccountForm, form.credentialRef])

  useEffect(() => {
    if (!isGoogleAccountForm) return
    setGoogleOauthError(null)
    setGoogleOauthOutput(null)
  }, [googleAuthMode, isGoogleAccountForm])

  useEffect(() => {
    if (!isGroqAccountForm) return
    if (groqAuthMode === 'api') {
      if (currentCredentialIsEnvGroq(form.credentialRef)) return
      setForm((current) => ({
        ...current,
        credentialRef: 'env:XAI_API_KEY',
      }))
    } else if (groqAuthMode === 'oauth' && currentCredentialIsEnvGroq(form.credentialRef)) {
      setForm((current) => ({
        ...current,
        credentialRef: 'grok-auth:portal',
      }))
    }
  }, [groqAuthMode, isGroqAccountForm, form.credentialRef])

  useEffect(() => {
    if (!isGroqAccountForm) return
    setGroqOauthError(null)
    setGroqOauthOutput(null)
  }, [groqAuthMode, isGroqAccountForm])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold">{poolSnapshot?.summary.accountCount ?? 0}</div>
          <div className="text-xs text-muted-foreground">{t('managedAccounts')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold">{poolSnapshot?.summary.allocatedAgentCount ?? 0}</div>
          <div className="text-xs text-muted-foreground">{t('allocatedAgents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold">{poolSnapshot?.summary.fallbackProtectedAgentCount ?? 0}</div>
          <div className="text-xs text-muted-foreground">{t('fallbackProtected')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold">{poolSnapshot?.summary.warningCount ?? 0}</div>
          <div className="text-xs text-muted-foreground">{t('accountsNearLimit')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
          <div className="text-xl sm:text-2xl font-bold">{poolSnapshot?.summary.recentFailoverCount ?? 0}</div>
          <div className="text-xs text-muted-foreground">{t('recentFailovers')}</div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[1.35fr_0.95fr] gap-4 sm:gap-6">
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">{t('sessionPool')}</h2>
                <p className="text-sm text-muted-foreground">{t('sessionPoolDesc')}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="ghost" onClick={() => setAllAccountDetails(true)} disabled={poolLoading}>
                  Minimize All
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAllAccountDetails(false)} disabled={poolLoading}>
                  Expand All
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => mutatePool('POST', '/api/session-pool', { action: 'enforce-codex-oauth' })}
                  disabled={isMutating || poolLoading}
                >
                  Enforce Codex OAuth
                </Button>
                <Button size="sm" onClick={() => mutatePool('POST', '/api/session-pool', { action: 'rebalance' })} disabled={isMutating || poolLoading}>
                  {t('rebalance')}
                </Button>
              </div>
            </div>

            {poolErrorText && <div className="mb-3 text-sm text-red-500">{poolErrorText}</div>}
            {poolLoading && !poolSnapshot ? (
              <Loader variant="inline" label={t('loadingSessions')} />
            ) : poolSnapshot?.accounts.length ? (
              <div className="space-y-3 sm:space-y-4">
                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <input
                    className="bg-secondary rounded px-3 py-2 text-sm w-full md:flex-1 md:min-w-56"
                    placeholder={t('searchAccountsPlaceholder')}
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                  />
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {(['all', 'healthy', 'warning', 'issues'] as const).map((key) => (
                      <Button
                        key={key}
                        size="sm"
                        variant={accountHealthFilter === key ? 'default' : 'secondary'}
                        onClick={() => setAccountHealthFilter(key)}
                        className="shrink-0"
                      >
                        {t(`healthFilter${key.charAt(0).toUpperCase() + key.slice(1)}` as any)}
                      </Button>
                    ))}
                  </div>
                </div>

                {visibleAccounts.length ? visibleAccounts.map((account) => {
                  const detailHidden = Boolean(accountDetailHidden[account.id])
                  const isEditing = editingAccountId === account.id && Boolean(accountEditDraft)
                  const primaryBadges = getVisibleAgentBadges(`primary-${account.id}`, account.primaryAgents)
                  const fallbackBadges = getVisibleAgentBadges(`fallback-${account.id}`, account.fallbackAgents)
                  return (
                  <div key={account.id} className="border border-border rounded-lg p-3 sm:p-4 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">{account.label}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${healthTone(account.health.state)}`}>{account.health.state}</span>
                          {!account.enabled && <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">{t('disabledStatus')}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          <span>{account.provider}</span>
                          {account.runtimeType && <span>{account.runtimeType}</span>}
                          {account.preferredModel && <span>{getModelDisplayName(account.preferredModel)}</span>}
                          {typeof account.metadata?.reasoningEffort === 'string' && account.metadata.reasoningEffort && (
                            <span>reasoning: {account.metadata.reasoningEffort}</span>
                          )}
                          {account.credentialRef && <span>{account.credentialRef}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
                        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => toggleAccountDetails(account.id)}>
                          {detailHidden ? 'Details' : 'Minimize'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="shrink-0"
                          onClick={() => (isEditing ? cancelAccountEdit() : beginAccountEdit(account))}
                          disabled={isMutating}
                        >
                          {isEditing ? 'Cancel Edit' : 'Edit'}
                        </Button>
                        {isEditing && (
                          <Button
                            size="sm"
                            variant="default"
                            className="shrink-0"
                            onClick={() => saveAccountEdit(account.id)}
                            disabled={isMutating}
                          >
                            Save
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => mutatePool('POST', '/api/session-pool', { action: 'mark-success', accountId: account.id })} disabled={isMutating}>{t('resetHealth')}</Button>
                        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => mutatePool('POST', '/api/session-pool', { action: 'mark-failure', accountId: account.id, reason: 'manual_mark_failed' })} disabled={isMutating}>{t('markFailed')}</Button>
                        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => mutatePool('PUT', '/api/session-pool', { accountId: account.id, enabled: !account.enabled })} disabled={isMutating}>
                          {account.enabled ? t('disable') : t('enable')}
                        </Button>
                        <Button size="sm" variant="ghost" className="shrink-0 text-red-500 hover:text-red-400" onClick={() => mutatePool('DELETE', `/api/session-pool?accountId=${account.id}`)} disabled={isMutating}>{t('remove')}</Button>
                      </div>
                    </div>

                    {isEditing && accountEditDraft && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-border/70 rounded-md p-3 bg-secondary/30">
                        <input
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.label}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, label: event.target.value } : current)}
                          placeholder="Account label"
                        />
                        <select
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.provider}
                          onChange={(event) => setAccountEditDraft((current) => {
                            if (!current) return current
                            const nextProvider = event.target.value
                            const nextReasoningOptions = REASONING_OPTIONS_BY_PROVIDER[nextProvider] || []
                            return {
                              ...current,
                              provider: nextProvider,
                              reasoningEffort: nextReasoningOptions.includes(current.reasoningEffort as ReasoningEffort)
                                ? current.reasoningEffort
                                : '',
                            }
                          })}
                        >
                          {['openai', 'anthropic', 'openrouter', 'ollama', 'google', 'grok'].map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                        </select>
                        <select
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.runtimeType}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, runtimeType: event.target.value } : current)}
                        >
                          {['codex', 'claude', 'openrouter', 'local', 'openclaw', 'hermes', 'custom'].map((runtime) => <option key={runtime} value={runtime}>{runtime}</option>)}
                        </select>
                        <input
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.preferredModel}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, preferredModel: event.target.value } : current)}
                          placeholder="Preferred model"
                        />
                        {(REASONING_OPTIONS_BY_PROVIDER[accountEditDraft.provider] || []).length > 0 && (
                          <select
                            className="bg-secondary rounded px-3 py-2 text-xs"
                            value={accountEditDraft.reasoningEffort}
                            onChange={(event) => setAccountEditDraft((current) => current ? { ...current, reasoningEffort: event.target.value } : current)}
                          >
                            <option value="">Provider default reasoning</option>
                            {(REASONING_OPTIONS_BY_PROVIDER[accountEditDraft.provider] || []).map((effort) => (
                              <option key={effort} value={effort}>{effort}</option>
                            ))}
                          </select>
                        )}
                        <input
                          className="bg-secondary rounded px-3 py-2 text-xs sm:col-span-2"
                          value={accountEditDraft.credentialRef}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, credentialRef: event.target.value } : current)}
                          placeholder="Credential ref"
                        />
                        <input
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.monthlyBudgetUsd}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, monthlyBudgetUsd: event.target.value } : current)}
                          placeholder="30d budget (USD)"
                        />
                        <input
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.maxAgents}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, maxAgents: event.target.value } : current)}
                          placeholder="Max agents"
                        />
                        <input
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.dailyTokenLimit}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, dailyTokenLimit: event.target.value } : current)}
                          placeholder="24h token limit"
                        />
                        <input
                          className="bg-secondary rounded px-3 py-2 text-xs"
                          value={accountEditDraft.dailyRequestLimit}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, dailyRequestLimit: event.target.value } : current)}
                          placeholder="24h request limit"
                        />
                        <textarea
                          className="bg-secondary rounded px-3 py-2 text-xs min-h-16 sm:col-span-2"
                          value={accountEditDraft.notes}
                          onChange={(event) => setAccountEditDraft((current) => current ? { ...current, notes: event.target.value } : current)}
                          placeholder="Notes"
                        />
                        <label className="sm:col-span-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={accountEditDraft.enabled}
                            onChange={(event) => setAccountEditDraft((current) => current ? { ...current, enabled: event.target.checked } : current)}
                          />
                          Enabled
                        </label>
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 text-xs">
                      <div className="bg-secondary/60 rounded p-2.5 sm:p-3">
                        <div className="text-muted-foreground">{t('cost30d')}</div>
                        <div className="font-medium text-foreground text-sm">{formatCost(account.usage.cost30d)}</div>
                      </div>
                      <div className="bg-secondary/60 rounded p-2.5 sm:p-3">
                        <div className="text-muted-foreground">{t('tokens24h')}</div>
                        <div className="font-medium text-foreground text-sm">{formatNumber(account.usage.totalTokens1d)}</div>
                      </div>
                      <div className="bg-secondary/60 rounded p-2.5 sm:p-3">
                        <div className="text-muted-foreground">{t('requests24h')}</div>
                        <div className="font-medium text-foreground text-sm">{formatNumber(account.usage.requestCount1d)}</div>
                      </div>
                      <div className="bg-secondary/60 rounded p-2.5 sm:p-3">
                        <div className="text-muted-foreground">{t('coverage')}</div>
                        <div className="font-medium text-foreground text-sm">{account.allocationCounts.primary} {t('primaryShort')} / {account.allocationCounts.fallback} {t('fallbackShort')}</div>
                      </div>
                    </div>

                    {!detailHidden && (
                      <>
                        <div className="grid md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <div className="text-muted-foreground mb-1.5">{t('primaryAgentsLabel')}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {account.primaryAgents.length ? primaryBadges.items.map((agent) => (
                                <span key={agent.id} className="px-2 py-1 rounded-md bg-primary/10 text-primary">{agent.name}</span>
                              )) : <span className="text-muted-foreground">{t('noneAssigned')}</span>}
                              {primaryBadges.hiddenCount > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setExpandedAgentBadges((current) => ({ ...current, [`primary-${account.id}`]: true }))}
                                >
                                  +{primaryBadges.hiddenCount} more
                                </Button>
                              )}
                              {primaryBadges.expanded && account.primaryAgents.length > 6 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setExpandedAgentBadges((current) => ({ ...current, [`primary-${account.id}`]: false }))}
                                >
                                  Show less
                                </Button>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1.5">{t('fallbackAgentsLabel')}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {account.fallbackAgents.length ? fallbackBadges.items.map((agent) => (
                                <span key={agent.id} className="px-2 py-1 rounded-md bg-secondary text-muted-foreground">{agent.name}</span>
                              )) : <span className="text-muted-foreground">{t('noFallbackAssignments')}</span>}
                              {fallbackBadges.hiddenCount > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setExpandedAgentBadges((current) => ({ ...current, [`fallback-${account.id}`]: true }))}
                                >
                                  +{fallbackBadges.hiddenCount} more
                                </Button>
                              )}
                              {fallbackBadges.expanded && account.fallbackAgents.length > 6 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setExpandedAgentBadges((current) => ({ ...current, [`fallback-${account.id}`]: false }))}
                                >
                                  Show less
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>

                        {account.monthlyBudgetUsd || account.dailyTokenLimit || account.dailyRequestLimit || account.maxAgents ? (
                          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                            {account.monthlyBudgetUsd ? <div className="text-muted-foreground">Budget: {(account.usage.monthlyBudgetPct || 0).toFixed(0)}% / {formatCost(account.monthlyBudgetUsd)}</div> : <div />}
                            {account.dailyTokenLimit ? <div className="text-muted-foreground">Token cap: {(account.usage.dailyTokenPct || 0).toFixed(0)}% / {formatNumber(account.dailyTokenLimit)}</div> : <div />}
                            {account.dailyRequestLimit ? <div className="text-muted-foreground">Request cap: {(account.usage.dailyRequestPct || 0).toFixed(0)}% / {formatNumber(account.dailyRequestLimit)}</div> : <div />}
                            {account.maxAgents ? <div className="text-muted-foreground">{t('maxAgentsLabel')}: {account.maxAgents}</div> : <div />}
                          </div>
                        ) : null}

                        {account.notes && <div className="text-xs text-muted-foreground">{account.notes}</div>}
                      </>
                    )}
                  </div>
                  )
                }) : (
                  <div className="text-sm text-muted-foreground">{t('noFilteredAccounts')}</div>
                )}

                {hiddenAccountCount > 0 && (
                  <div className="flex justify-center">
                    <Button size="sm" variant="secondary" onClick={() => setShowAllAccounts(true)}>
                      See {hiddenAccountCount} more accounts
                    </Button>
                  </div>
                )}
                {showAllAccounts && filteredAccounts.length > 6 && (
                  <div className="flex justify-center">
                    <Button size="sm" variant="ghost" onClick={() => setShowAllAccounts(false)}>
                      Show fewer accounts
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{t('noManagedAccountsDesc')}</div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-3 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t('providerSetupStatus')}</h2>
                <p className="text-sm text-muted-foreground">{t('providerSetupStatusDesc')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setProviderSetupMinimized((current) => !current)}>
                  {providerSetupMinimized ? 'Show' : 'Minimize'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => loadPool({ discovery: true, models: true })} disabled={poolLoading}>
                  {t('refreshSetupStatus')}
                </Button>
              </div>
            </div>

            {!providerSetupMinimized && (
              <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">OPENAI_API_KEY</div>
                <div className={providerDiscovery?.directApiKeys.openai ? 'text-green-500' : 'text-yellow-500'}>
                  {providerDiscovery?.directApiKeys.openai ? t('keyConfigured') : t('keyMissing')}
                </div>
              </div>
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">OPENROUTER_API_KEY</div>
                <div className={providerDiscovery?.directApiKeys.openrouter ? 'text-green-500' : 'text-yellow-500'}>
                  {providerDiscovery?.directApiKeys.openrouter ? t('keyConfigured') : t('keyMissing')}
                </div>
              </div>
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">ANTHROPIC_API_KEY</div>
                <div className={providerDiscovery?.directApiKeys.anthropic ? 'text-green-500' : 'text-yellow-500'}>
                  {providerDiscovery?.directApiKeys.anthropic ? t('keyConfigured') : t('keyMissing')}
                </div>
              </div>
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">GOOGLE_API_KEY</div>
                <div className={providerDiscovery?.directApiKeys.google ? 'text-green-500' : 'text-yellow-500'}>
                  {providerDiscovery?.directApiKeys.google ? t('keyConfigured') : t('keyMissing')}
                </div>
              </div>
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">XAI_API_KEY</div>
                <div className={(providerDiscovery?.directApiKeys.grok || providerDiscovery?.directApiKeys.groq) ? 'text-green-500' : 'text-yellow-500'}>
                  {(providerDiscovery?.directApiKeys.grok || providerDiscovery?.directApiKeys.groq) ? t('keyConfigured') : t('keyMissing')}
                </div>
              </div>
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">OLLAMA_HOST</div>
                <div className={providerDiscovery?.ollama.reachable ? 'text-green-500' : 'text-yellow-500'}>
                  {providerDiscovery?.ollama.reachable ? t('ollamaReachable') : t('ollamaUnreachable')}
                </div>
                <div className="text-muted-foreground truncate">{providerDiscovery?.ollama.host || 'http://127.0.0.1:11434'}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">OpenAI models</div>
                <div className="text-foreground">{providerModels?.openai?.length ?? 0}</div>
              </div>
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">Anthropic models</div>
                <div className="text-foreground">{providerModels?.anthropic?.length ?? 0}</div>
              </div>
              <div className="bg-secondary/60 rounded p-2.5">
                <div className="text-muted-foreground">OpenRouter models</div>
                <div className="text-foreground">{providerModels?.openrouter?.length ?? 0}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">{t('detectedCodexOauth')}</div>
              {providerDiscovery?.codexOAuth?.length ? providerDiscovery.codexOAuth.map((profile) => {
                const alreadyAdded = credentialRefs.has(profile.ref)
                return (
                  <div key={profile.ref} className="border border-border rounded-md p-2.5 text-xs space-y-1.5">
                    <div className="font-medium text-foreground">{profile.label}</div>
                    <div className="text-muted-foreground break-all">{profile.ref}</div>
                    {profile.plan ? <div className="text-muted-foreground">{t('oauthPlanLabel')}: {profile.plan}</div> : null}
                    {profile.expiresAt ? <div className="text-muted-foreground">{t('oauthExpiresLabel')}: {new Date(profile.expiresAt).toLocaleString()}</div> : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={alreadyAdded || isMutating}
                      onClick={() => addDetectedAccount({
                        label: profile.label,
                        provider: 'openai',
                        runtimeType: 'codex',
                        preferredModel: 'openai/codex-mini-latest',
                        credentialRef: profile.ref,
                        notes: 'Detected Codex OAuth profile',
                      })}
                    >
                      {alreadyAdded ? t('alreadyAdded') : t('addDetectedAccount')}
                    </Button>
                  </div>
                )
              }) : (
                <div className="text-xs text-muted-foreground">{t('noCodexOauthDetected')}</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">{t('detectedClaudeOauth')}</div>
              {providerDiscovery?.claudeOAuth?.length ? providerDiscovery.claudeOAuth.map((profile) => {
                const alreadyAdded = credentialRefs.has(profile.ref)
                return (
                  <div key={profile.ref} className="border border-border rounded-md p-2.5 text-xs space-y-1.5">
                    <div className="font-medium text-foreground">{profile.label}</div>
                    <div className="text-muted-foreground break-all">{profile.ref}</div>
                    {profile.plan ? <div className="text-muted-foreground">{t('oauthPlanLabel')}: {profile.plan}</div> : null}
                    {profile.expiresAt ? <div className="text-muted-foreground">{t('oauthExpiresLabel')}: {new Date(profile.expiresAt).toLocaleString()}</div> : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={alreadyAdded || isMutating}
                      onClick={() => addDetectedAccount({
                        label: profile.label,
                        provider: 'anthropic',
                        runtimeType: 'claude',
                        preferredModel: 'anthropic/claude-sonnet-4-6',
                        credentialRef: profile.ref,
                        notes: 'Detected Claude OAuth profile',
                      })}
                    >
                      {alreadyAdded ? t('alreadyAdded') : t('addDetectedAccount')}
                    </Button>
                  </div>
                )
              }) : (
                <div className="text-xs text-muted-foreground">{t('noClaudeOauthDetected')}</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">{t('detectedGoogleOauth')}</div>
              {providerDiscovery?.googleOAuth?.length ? providerDiscovery.googleOAuth.map((profile) => {
                const alreadyAdded = credentialRefs.has(profile.ref)
                return (
                  <div key={profile.ref} className="border border-border rounded-md p-2.5 text-xs space-y-1.5">
                    <div className="font-medium text-foreground">{profile.label}</div>
                    <div className="text-muted-foreground break-all">{profile.ref}</div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={alreadyAdded || isMutating}
                      onClick={() => addDetectedAccount({
                        label: profile.label,
                        provider: 'google',
                        runtimeType: 'custom',
                        preferredModel: 'google/gemini-2.5-flash',
                        credentialRef: profile.ref,
                        notes: 'Detected Google OAuth (gcloud ADC) profile',
                      })}
                    >
                      {alreadyAdded ? t('alreadyAdded') : t('addDetectedAccount')}
                    </Button>
                  </div>
                )
              }) : (
                <div className="text-xs text-muted-foreground">{t('noGoogleOauthDetected')}</div>
              )}
            </div>
              </>
            )}
          </div>

          <form onSubmit={handleCreateAccount} className="bg-card border border-border rounded-lg p-3 sm:p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t('addAccount')}</h2>
                <p className="text-sm text-muted-foreground">{t('addAccountDesc')}</p>
              </div>
              <Button size="sm" type="button" variant="ghost" onClick={() => setAddAccountMinimized((current) => !current)}>
                {addAccountMinimized ? 'Show' : 'Minimize'}
              </Button>
            </div>
            {!addAccountMinimized && (
              <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">{t('quickPresetsLabel')}:</span>
              <Button size="sm" type="button" variant="secondary" onClick={() => applyFormPreset('openai')}>OpenAI</Button>
              <Button size="sm" type="button" variant="secondary" onClick={() => applyFormPreset('anthropic')}>Anthropic</Button>
              <Button size="sm" type="button" variant="secondary" onClick={() => applyFormPreset('openrouter')}>OpenRouter</Button>
              <Button size="sm" type="button" variant="secondary" onClick={() => applyFormPreset('ollama')}>Ollama</Button>
              <Button size="sm" type="button" variant="secondary" onClick={() => applyFormPreset('google')}>Google</Button>
              <Button size="sm" type="button" variant="secondary" onClick={() => applyFormPreset('grok')}>Grok</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="bg-secondary rounded px-3 py-2 text-sm" placeholder={t('accountLabel')} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
              <select className="bg-secondary rounded px-3 py-2 text-sm" value={form.provider} onChange={(e) => handleProviderChange(e.target.value)}>
                {['openai', 'anthropic', 'openrouter', 'ollama', 'google', 'grok'].map((provider) => <option key={provider} value={provider}>{provider}</option>)}
              </select>
              <select
                className="bg-secondary rounded px-3 py-2 text-sm"
                value={form.runtimeType}
                onChange={(e) => {
                  const nextRuntime = e.target.value
                  setForm((current) => {
                    let nextCredentialRef = current.credentialRef
                    if (current.provider === 'openai' && nextRuntime === 'codex') {
                      if (codexAuthMode === 'api') nextCredentialRef = 'env:OPENAI_API_KEY'
                      else if (!String(nextCredentialRef || '').trim().startsWith('codex-auth:')) nextCredentialRef = ''
                    }
                    if (current.provider === 'anthropic' && nextRuntime === 'claude') {
                      if (anthropicAuthMode === 'api') nextCredentialRef = 'env:ANTHROPIC_API_KEY'
                      else if (!String(nextCredentialRef || '').trim().startsWith('claude-auth:')) nextCredentialRef = ''
                    }
                    if (current.provider === 'google') {
                      if (googleAuthMode === 'api') nextCredentialRef = 'env:GOOGLE_API_KEY'
                      else if (!String(nextCredentialRef || '').trim().startsWith('google-auth:')) nextCredentialRef = ''
                    }
                    if (current.provider === 'grok' || current.provider === 'groq') {
                      if (groqAuthMode === 'api') nextCredentialRef = 'env:XAI_API_KEY'
                      else if (!String(nextCredentialRef || '').trim().startsWith('grok-auth:')) nextCredentialRef = ''
                    }
                    return { ...current, runtimeType: nextRuntime, credentialRef: nextCredentialRef }
                  })
                }}
              >
                {['codex', 'claude', 'openrouter', 'local', 'openclaw', 'hermes', 'custom'].map((runtime) => <option key={runtime} value={runtime}>{runtime}</option>)}
              </select>
              {isCodexAccountForm && (
                <div className="sm:col-span-2 rounded-md border border-border/70 bg-secondary/30 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Codex authentication mode</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      type="button"
                      variant={codexAuthMode === 'oauth' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setCodexAuthMode('oauth')}
                    >
                      OAuth
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant={codexAuthMode === 'api' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setCodexAuthMode('api')}
                    >
                      API Key
                    </Button>
                  </div>
                  {codexAuthMode === 'oauth' ? (
                    <div className="space-y-2">
                      <input
                        className="bg-secondary rounded px-3 py-2 text-xs w-full"
                        placeholder="Codex account email (optional matcher)"
                        value={codexOauthEmail}
                        onChange={(event) => setCodexOauthEmail(event.target.value)}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          type="button"
                          variant="secondary"
                          onClick={connectCodexOAuth}
                          disabled={codexOauthBusy}
                        >
                          {codexOauthBusy ? 'Connecting...' : 'Connect Codex OAuth'}
                        </Button>
                        {codexOauthUrl && (
                          <a
                            className="text-xs text-primary underline"
                            href={codexOauthUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open login page
                          </a>
                        )}
                        {codexOauthCode && (
                          <span className="text-xs text-muted-foreground">Code: <code>{codexOauthCode}</code></span>
                        )}
                      </div>
                      {codexOauthError && <div className="text-xs text-red-500">{codexOauthError}</div>}
                      {codexOauthOutput && <pre className="text-[10px] bg-black/20 border border-border/60 rounded p-2 max-h-28 overflow-auto whitespace-pre-wrap">{codexOauthOutput}</pre>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        className="bg-secondary rounded px-3 py-2 text-xs w-full"
                        placeholder="OpenAI API key for Codex"
                        value={codexApiKey}
                        onChange={(event) => setCodexApiKey(event.target.value)}
                      />
                      <div className="text-[11px] text-muted-foreground">
                        API key is saved to integrations as `OPENAI_API_KEY`, and this account uses `env:OPENAI_API_KEY`.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isAnthropicAccountForm && (
                <div className="sm:col-span-2 rounded-md border border-border/70 bg-secondary/30 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Claude authentication mode</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      type="button"
                      variant={anthropicAuthMode === 'oauth' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setAnthropicAuthMode('oauth')}
                    >
                      OAuth
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant={anthropicAuthMode === 'api' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setAnthropicAuthMode('api')}
                    >
                      API Key
                    </Button>
                  </div>
                  {anthropicAuthMode === 'oauth' ? (
                    <div className="space-y-2">
                      <input
                        className="bg-secondary rounded px-3 py-2 text-xs w-full"
                        placeholder="Claude account email (optional matcher)"
                        value={anthropicOauthEmail}
                        onChange={(event) => setAnthropicOauthEmail(event.target.value)}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          type="button"
                          variant="secondary"
                          onClick={connectAnthropicOAuth}
                          disabled={anthropicOauthBusy}
                        >
                          {anthropicOauthBusy ? 'Connecting...' : 'Connect Claude OAuth'}
                        </Button>
                      </div>
                      {anthropicOauthError && <div className="text-xs text-red-500">{anthropicOauthError}</div>}
                      {anthropicOauthOutput && <pre className="text-[10px] bg-black/20 border border-border/60 rounded p-2 max-h-28 overflow-auto whitespace-pre-wrap">{anthropicOauthOutput}</pre>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        className="bg-secondary rounded px-3 py-2 text-xs w-full"
                        placeholder="Anthropic API key for Claude"
                        value={anthropicApiKey}
                        onChange={(event) => setAnthropicApiKey(event.target.value)}
                      />
                      <div className="text-[11px] text-muted-foreground">
                        API key is saved to integrations as `ANTHROPIC_API_KEY`, and this account uses `env:ANTHROPIC_API_KEY`.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isGoogleAccountForm && (
                <div className="sm:col-span-2 rounded-md border border-border/70 bg-secondary/30 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Google (Gemini) authentication mode</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      type="button"
                      variant={googleAuthMode === 'oauth' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setGoogleAuthMode('oauth')}
                    >
                      OAuth
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant={googleAuthMode === 'api' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setGoogleAuthMode('api')}
                    >
                      API Key
                    </Button>
                  </div>
                  {googleAuthMode === 'oauth' ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          type="button"
                          variant="secondary"
                          onClick={connectGoogleOAuth}
                          disabled={googleOauthBusy}
                        >
                          {googleOauthBusy ? 'Connecting...' : 'Connect Google OAuth'}
                        </Button>
                      </div>
                      {googleOauthError && <div className="text-xs text-red-500">{googleOauthError}</div>}
                      {googleOauthOutput && <pre className="text-[10px] bg-black/20 border border-border/60 rounded p-2 max-h-28 overflow-auto whitespace-pre-wrap">{googleOauthOutput}</pre>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        className="bg-secondary rounded px-3 py-2 text-xs w-full"
                        placeholder="Google API key for Gemini"
                        value={googleApiKey}
                        onChange={(event) => setGoogleApiKey(event.target.value)}
                      />
                      <div className="text-[11px] text-muted-foreground">
                        API key is saved to integrations as `GOOGLE_API_KEY`, and this account uses `env:GOOGLE_API_KEY`.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isGroqAccountForm && (
                <div className="sm:col-span-2 rounded-md border border-border/70 bg-secondary/30 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Grok (xAI) authentication mode</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      type="button"
                      variant={groqAuthMode === 'oauth' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setGroqAuthMode('oauth')}
                    >
                      OAuth
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant={groqAuthMode === 'api' ? 'default' : 'secondary'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setGroqAuthMode('api')}
                    >
                      API Key
                    </Button>
                  </div>
                  {groqAuthMode === 'oauth' ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          type="button"
                          variant="secondary"
                          onClick={connectGroqOAuth}
                          disabled={groqOauthBusy}
                        >
                          {groqOauthBusy ? 'Connecting...' : 'Connect Grok Portal'}
                        </Button>
                      </div>
                      {groqOauthError && <div className="text-xs text-red-500">{groqOauthError}</div>}
                      {groqOauthOutput && <pre className="text-[10px] bg-black/20 border border-border/60 rounded p-2 max-h-28 overflow-auto whitespace-pre-wrap">{groqOauthOutput}</pre>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        className="bg-secondary rounded px-3 py-2 text-xs w-full"
                        placeholder="Grok (xAI) API key"
                        value={groqApiKey}
                        onChange={(event) => setGroqApiKey(event.target.value)}
                      />
                      <div className="text-[11px] text-muted-foreground">
                        API key is saved to integrations as `XAI_API_KEY`, and this account uses `env:XAI_API_KEY`.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {supportsProviderModelDropdown ? (
                <div className="sm:col-span-2 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">Model catalog ({providerModelSource === 'live' ? 'live' : 'fallback'})</span>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => loadPool({ models: true, discovery: true })}
                      disabled={poolLoading}
                    >
                      Refresh models
                    </Button>
                  </div>
                  {form.provider === 'openrouter' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        type="button"
                        variant={openRouterModelFilters.free ? 'default' : 'secondary'}
                        className="h-7 px-2 text-xs"
                        onClick={() => setOpenRouterModelFilters((current) => ({ ...current, free: !current.free }))}
                      >
                        Free
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant={openRouterModelFilters.paid ? 'default' : 'secondary'}
                        className="h-7 px-2 text-xs"
                        onClick={() => setOpenRouterModelFilters((current) => ({ ...current, paid: !current.paid }))}
                      >
                        Paid
                      </Button>
                    </div>
                  )}
                  <div className={`grid gap-2 ${supportsReasoningEffort ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                    <select
                      className="bg-secondary rounded px-3 py-2 text-sm w-full"
                      value={form.preferredModel}
                      onChange={(e) => setForm({ ...form, preferredModel: e.target.value })}
                    >
                      <option value="">{t('preferredModel')}</option>
                      {filteredProviderModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                    {supportsReasoningEffort && (
                      <select
                        className="bg-secondary rounded px-3 py-2 text-sm w-full"
                        value={form.reasoningEffort}
                        onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}
                      >
                        <option value="">Provider default reasoning</option>
                        {formReasoningOptions.map((effort) => (
                          <option key={effort} value={effort}>{effort}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {!filteredProviderModelOptions.length && (
                    <div className="text-xs text-yellow-500">No models match current filter</div>
                  )}
                </div>
              ) : (
                <div className="sm:col-span-2 grid gap-2 md:grid-cols-2">
                  <input className="bg-secondary rounded px-3 py-2 text-sm" placeholder={t('preferredModel')} value={form.preferredModel} onChange={(e) => setForm({ ...form, preferredModel: e.target.value })} />
                  {supportsReasoningEffort && (
                    <select
                      className="bg-secondary rounded px-3 py-2 text-sm"
                      value={form.reasoningEffort}
                      onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}
                    >
                      <option value="">Provider default reasoning</option>
                      {formReasoningOptions.map((effort) => (
                        <option key={effort} value={effort}>{effort}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <input
                className="bg-secondary rounded px-3 py-2 text-sm col-span-2"
                placeholder={t('credentialRef')}
                value={form.credentialRef}
                onChange={(e) => setForm({ ...form, credentialRef: e.target.value })}
                disabled={
                  (isCodexAccountForm && codexAuthMode === 'api') ||
                  (isAnthropicAccountForm && anthropicAuthMode === 'api') ||
                  (isGoogleAccountForm && googleAuthMode === 'api') ||
                  (isGroqAccountForm && groqAuthMode === 'api')
                }
              />
              <div className="col-span-2 text-xs text-muted-foreground">{providerHint}</div>
              <input className="bg-secondary rounded px-3 py-2 text-sm" placeholder={t('monthlyBudgetUsd')} value={form.monthlyBudgetUsd} onChange={(e) => setForm({ ...form, monthlyBudgetUsd: e.target.value })} />
              <input className="bg-secondary rounded px-3 py-2 text-sm" placeholder={t('maxAgentsPlaceholder')} value={form.maxAgents} onChange={(e) => setForm({ ...form, maxAgents: e.target.value })} />
              <input className="bg-secondary rounded px-3 py-2 text-sm" placeholder={t('dailyTokenLimit')} value={form.dailyTokenLimit} onChange={(e) => setForm({ ...form, dailyTokenLimit: e.target.value })} />
              <input className="bg-secondary rounded px-3 py-2 text-sm" placeholder={t('dailyRequestLimit')} value={form.dailyRequestLimit} onChange={(e) => setForm({ ...form, dailyRequestLimit: e.target.value })} />
              <textarea className="bg-secondary rounded px-3 py-2 text-sm col-span-2 min-h-20" placeholder={t('accountNotes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button type="submit" disabled={isMutating}>{t('saveAccount')}</Button>
              </>
            )}
          </form>

          <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-semibold">{t('recentSessionEvents')}</h2>
              <Button size="sm" variant="ghost" onClick={() => setEventsExpanded((current) => !current)}>
                {eventsExpanded ? 'Show less' : 'See more'}
              </Button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {visibleEvents.length ? visibleEvents.map((event) => (
                <div key={event.id} className="border border-border rounded p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{event.eventType}</span>
                    <span className="text-muted-foreground">{new Date(event.createdAt * 1000).toLocaleString()}</span>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    {[event.accountLabel, event.agentName].filter(Boolean).join(' - ')}
                  </div>
                </div>
              )) : <div className="text-sm text-muted-foreground">{t('noSessionEvents')}</div>}
            </div>
            {!eventsExpanded && sessionEvents.length > visibleEvents.length && (
              <div className="text-xs text-muted-foreground mt-2">+{sessionEvents.length - visibleEvents.length} more events</div>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-semibold">{t('agentMappings')}</h2>
              <Button size="sm" variant="ghost" onClick={() => setMappingsExpanded((current) => !current)}>
                {mappingsExpanded ? 'Show less' : 'See more'}
              </Button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {visibleMappings.length ? visibleMappings.map((agent) => (
                <div key={agent.id} className="border border-border rounded p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{agent.name}</span>
                    <span className="text-muted-foreground">{t('workload')}: {agent.workloadScore}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {agent.allocationChain.length ? agent.allocationChain.map((allocation) => (
                      <span key={`${agent.id}-${allocation.accountId}-${allocation.rank}`} className={`px-2 py-1 rounded ${allocation.allocationMode === 'primary' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                        {allocation.label} {allocation.suggestedModel ? `- ${getModelDisplayName(allocation.suggestedModel)}` : ''}
                      </span>
                    )) : <span className="text-muted-foreground">{t('unallocatedAgent')}</span>}
                  </div>
                </div>
              )) : <div className="text-sm text-muted-foreground">{t('noAgentMappings')}</div>}
            </div>
            {!mappingsExpanded && mappedAgents.length > visibleMappings.length && (
              <div className="text-xs text-muted-foreground mt-2">+{mappedAgents.length - visibleMappings.length} more mappings</div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-3 sm:p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-sm text-muted-foreground">{t('sortBy')}:</span>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
              <button key={s} onClick={() => setSessionSort(s)}
                className={`shrink-0 px-2.5 py-1.5 text-xs rounded-md ${sessionSort === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
              >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <input
            className="bg-secondary rounded px-3 py-2 text-sm w-full sm:w-auto sm:min-w-56 sm:ml-auto"
            placeholder={t('searchSessionsPlaceholder')}
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
          />
        </div>

        {sorted.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p className="text-lg mb-1">{t('noSessionCostData')}</p>
            <p className="text-sm">{t('noSessionCostDataDesc')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map(entry => {
              const sessionInfo = sessions.find((s: any) => s.id === entry.sessionId)
              return (
                <div key={entry.sessionId} className="border border-border rounded-lg p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {entry.sessionKey || sessionInfo?.key || entry.sessionId}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        {sessionInfo?.active && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />}
                        <span>{sessionInfo?.active ? t('activeStatus') : t('inactiveStatus')}</span>
                        {entry.model && <span>| {getModelDisplayName(entry.model)}</span>}
                        {sessionInfo?.kind && <span>| {sessionInfo.kind}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold text-foreground">{formatCost(entry.totalCost)}</div>
                      <div className="text-xs text-muted-foreground">{formatNumber(entry.totalTokens)} tokens</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">
                    <div><span className="font-medium text-foreground">{entry.requestCount}</span> {t('requests')}</div>
                    <div><span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span> {t('inShort')}</div>
                    <div><span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span> {t('outShort')}</div>
                    <div>{entry.totalTokens > 0 ? <span className="font-medium text-foreground">{formatCost(entry.totalCost / Math.max(entry.requestCount, 1))}</span> : '-'} {t('avgPerReq')}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tasks View ──────────────────────────────────

function TasksView({ taskData, onRefresh }: { taskData: TaskCostsResponse | null; onRefresh: () => void }) {
  const t = useTranslations('costTracker')
  if (!taskData || taskData.tasks.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noTaskCostData')}</div>
        <div className="text-sm">{t('noTaskCostDataDesc')}</div>
        <Button onClick={onRefresh} className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{taskData.tasks.length}</div>
          <div className="text-sm text-muted-foreground">{t('tasksWithCosts')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(taskData.summary.totalCost)}</div>
          <div className="text-sm text-muted-foreground">{t('attributedCost')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(taskData.summary.totalTokens)}</div>
          <div className="text-sm text-muted-foreground">{t('attributedTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-orange-500">{formatCost(taskData.unattributed.totalCost)}</div>
          <div className="text-sm text-muted-foreground">{t('unattributed')}</div>
        </div>
      </div>

      {/* Task list */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('tasksByCost')}</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {taskData.tasks.map(task => (
            <div key={task.taskId} className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                    task.priority === 'critical' ? 'bg-red-500/10 text-red-500' :
                    task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' :
                    task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                    'bg-secondary text-muted-foreground'
                  }`}>{task.priority}</span>
                  {task.project.ticketRef && <span className="text-xs text-muted-foreground font-mono shrink-0">{task.project.ticketRef}</span>}
                  <span className="font-medium text-foreground truncate">{task.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
                    task.status === 'done' ? 'bg-green-500/10 text-green-500' :
                    task.status === 'in_progress' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-secondary text-muted-foreground'
                  }`}>{task.status}</span>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="font-medium text-foreground">{formatCost(task.stats.totalCost)}</div>
                  <div className="text-xs text-muted-foreground">{formatNumber(task.stats.totalTokens)} {t('tokens')} | {task.stats.requestCount} {t('reqs')}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
