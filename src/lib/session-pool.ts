import { getDatabase } from '@/lib/db'
import { getProviderFromModel } from '@/lib/provider-subscriptions'

export type SessionAllocationMode = 'primary' | 'fallback'
type SessionReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type SessionPoolHealthState =
  | 'healthy'
  | 'warning'
  | 'cooldown'
  | 'failed'
  | 'disabled'
  | 'exhausted'

export interface SessionPoolAccountInput {
  label: string
  provider: string
  runtimeType?: string | null
  preferredModel?: string | null
  credentialRef?: string | null
  status?: 'active' | 'degraded' | 'failed' | 'disabled'
  enabled?: boolean
  priority?: number
  weight?: number
  maxAgents?: number | null
  softLimitPct?: number
  hardLimitPct?: number
  monthlyBudgetUsd?: number | null
  dailyTokenLimit?: number | null
  dailyRequestLimit?: number | null
  notes?: string | null
  metadata?: Record<string, unknown>
}

interface SessionPoolAccountRow {
  id: number
  workspace_id: number
  label: string
  provider: string
  runtime_type: string | null
  preferred_model: string | null
  credential_ref: string | null
  status: string
  enabled: number
  priority: number
  weight: number
  max_agents: number | null
  soft_limit_pct: number
  hard_limit_pct: number
  monthly_budget_usd: number | null
  daily_token_limit: number | null
  daily_request_limit: number | null
  consecutive_failures: number
  last_success_at: number | null
  last_failure_at: number | null
  cooldown_until: number | null
  notes: string | null
  metadata: string | null
}

interface SessionPoolAllocationRow {
  id: number
  workspace_id: number
  agent_id: number
  account_id: number
  allocation_mode: SessionAllocationMode
  rank: number
  assigned_reason: string | null
  metadata: string | null
}

interface SessionPoolEventRow {
  id: number
  workspace_id: number
  account_id: number | null
  agent_id: number | null
  event_type: string
  detail: string | null
  created_at: number
}

interface AgentRow {
  id: number
  name: string
  role: string
  status: string
  hidden?: number
  config: string | null
  runtime_type: string | null
  preferred_runtime: string | null
}

interface AgentUsageStats {
  cost30d: number
  requestCount30d: number
  totalTokens30d: number
  totalTokens1d: number
  requestCount1d: number
}

export interface SessionPoolAccountUsage {
  cost30d: number
  requestCount30d: number
  totalTokens30d: number
  totalTokens1d: number
  requestCount1d: number
  monthlyBudgetPct: number | null
  dailyTokenPct: number | null
  dailyRequestPct: number | null
  maxLimitPct: number | null
}

export interface SessionPoolAccountHealth {
  state: SessionPoolHealthState
  reason: string
  consecutiveFailures: number
  lastSuccessAt: number | null
  lastFailureAt: number | null
  cooldownUntil: number | null
}

export interface SessionPoolAccountSummary {
  id: number
  label: string
  provider: string
  runtimeType: string | null
  preferredModel: string | null
  credentialRef: string | null
  status: string
  enabled: boolean
  priority: number
  weight: number
  maxAgents: number | null
  softLimitPct: number
  hardLimitPct: number
  monthlyBudgetUsd: number | null
  dailyTokenLimit: number | null
  dailyRequestLimit: number | null
  notes: string | null
  metadata: Record<string, unknown>
  health: SessionPoolAccountHealth
  usage: SessionPoolAccountUsage
  allocationCounts: {
    primary: number
    fallback: number
    total: number
  }
  primaryAgents: Array<{ id: number; name: string; status: string }>
  fallbackAgents: Array<{ id: number; name: string; status: string }>
}

export interface SessionPoolAgentAllocation {
  accountId: number
  label: string
  provider: string
  runtimeType: string | null
  allocationMode: SessionAllocationMode
  rank: number
  healthState: SessionPoolHealthState
  suggestedModel: string | null
  reasoningEffort: SessionReasoningEffort | null
  assignedReason: string | null
}

export interface SessionPoolAgentSummary {
  id: number
  name: string
  role: string
  status: string
  preference: {
    providers: string[]
    runtimes: string[]
    models: string[]
  }
  workloadScore: number
  currentPrimaryAccountId: number | null
  allocationChain: SessionPoolAgentAllocation[]
}

export interface SessionPoolSnapshot {
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
  accounts: SessionPoolAccountSummary[]
  agents: SessionPoolAgentSummary[]
  events: Array<{
    id: number
    accountId: number | null
    accountLabel: string | null
    agentId: number | null
    agentName: string | null
    eventType: string
    detail: Record<string, unknown>
    createdAt: number
  }>
}

export interface SessionDispatchCandidate {
  accountId: number
  label: string
  provider: string
  runtimeType: string | null
  preferredModel: string | null
  credentialRef: string | null
  suggestedModel: string | null
  reasoningEffort: SessionReasoningEffort | null
  healthState: SessionPoolHealthState
  allocationMode: SessionAllocationMode
  rank: number
}

const DEFAULT_MODELS_BY_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic/claude-sonnet-4-6',
  openai: 'openai/codex-mini-latest',
  openrouter: 'openrouter/anthropic/claude-sonnet-4',
  ollama: 'ollama/qwen2.5-coder:14b',
  grok: 'grok/grok-3-mini',
  groq: 'groq/llama-3.3-70b-versatile',
  google: 'google/gemini-2.5-flash',
}

const RUNTIME_PROVIDER_HINTS: Record<string, string[]> = {
  claude: ['anthropic'],
  codex: ['openai'],
  openrouter: ['openrouter'],
  local: ['ollama'],
  ollama: ['ollama'],
  hermes: ['anthropic', 'openai'],
  openclaw: [],
  custom: [],
}

function safeParseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

function normalizeLower(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeLower(value)).filter(Boolean))]
}

function normalizeReasoningEffort(value: unknown): SessionReasoningEffort | null {
  const normalized = normalizeLower(value)
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') return normalized
  return null
}

function getReasoningEffortRank(value: unknown): number {
  switch (normalizeReasoningEffort(value)) {
    case 'low':
      return 1
    case 'medium':
      return 2
    case 'high':
      return 3
    case 'xhigh':
      return 4
    default:
      return 0
  }
}

function getMetadataReasoningEffort(metadata: Record<string, unknown> | null | undefined): SessionReasoningEffort | null {
  if (!metadata) return null
  return normalizeReasoningEffort(metadata.reasoningEffort)
}

function estimateModelCapability(model: string | null | undefined): number {
  const normalized = normalizeLower(model)
  if (!normalized) return 50

  if (normalized.includes('claude-opus-4-6')) return 98
  if (normalized.includes('o3')) return 96
  if (normalized.includes('gpt-5.4')) return 95
  if (normalized.includes('claude-sonnet-4-6')) return 90
  if (normalized.includes('gemini-2.5-pro')) return 89
  if (normalized.includes('claude-sonnet-4-5')) return 86
  if (normalized.includes('gpt-4.1')) return normalized.includes('mini') ? 72 : 84
  if (normalized.includes('codex-mini')) return 74
  if (normalized.includes('claude-haiku')) return 60
  if (normalized.includes('gemini-2.5-flash')) return 76
  if (normalized.includes('gemini-2.0-flash')) return 68
  if (normalized.includes('llama-3.3-70b')) return 64
  if (normalized.includes('llama-3.1-8b')) return 48
  if (normalized.includes('qwen2.5-coder:14b')) return 52

  const provider = normalizeProvider(getProviderFromModel(normalized))
  switch (provider) {
    case 'anthropic':
      return 82
    case 'openai':
      return 80
    case 'google':
      return 78
    case 'groq':
      return 60
    case 'openrouter':
      return 72
    case 'ollama':
      return 50
    default:
      return 55
  }
}

function normalizeProvider(value: string): string {
  const normalized = normalizeLower(value)
  return normalized === 'local' ? 'ollama' : normalized
}

function normalizeRuntime(value: string | null | undefined): string | null {
  const normalized = normalizeLower(value)
  return normalized || null
}

function clampPercent(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(1, value))
}

function normalizePositiveInt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const normalized = Math.max(0, Math.floor(value))
  return normalized > 0 ? normalized : null
}

function getSessionResourceKey(
  provider: string,
  runtimeType: string | null | undefined,
  credentialRef: string | null | undefined,
  fallbackId: number,
): string {
  const normalizedProvider = normalizeProvider(provider)
  const normalizedRuntime = normalizeRuntime(runtimeType) || 'default'
  const normalizedCredential = normalizeLower(credentialRef)
  return normalizedCredential
    ? `${normalizedProvider}:${normalizedRuntime}:${normalizedCredential}`
    : `${normalizedProvider}:${normalizedRuntime}:account:${fallbackId}`
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return ['1', 'true', 'yes', 'y', 'on', 'enabled', 'active'].includes(normalized)
  }
  return false
}

function getLowerConfigString(config: Record<string, unknown>, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isManagementTierAgent(agent: AgentRow): boolean {
  const roleText = `${agent.name} ${agent.role}`.toLowerCase()
  const config = safeParseJson(agent.config)

  const explicitFlags = [
    config.executive,
    config.orgHead,
    config.admin,
    config.isAdmin,
    config.departmentLead,
    config.departmentManager,
    config.teamLead,
    config.teamManager,
    config.manager,
  ]
  if (explicitFlags.some((value) => isTruthyFlag(value))) return true

  const routingTier = getLowerConfigString(config, 'taskRoutingTier')
  if (/(executive|manager|lead|director|head)/i.test(routingTier)) return true

  const orgTier = getLowerConfigString(config, 'orgTier')
  if (/(executive|manager|lead|director|head)/i.test(orgTier)) return true

  const title = getLowerConfigString(config, 'title')
  if (/(chief|executive|manager|director|team lead|department lead|head of)/i.test(title)) return true

  return /(chief|ceo|cto|cfo|coo|cio|executive|department lead|department manager|team lead|director|head|manager)/i.test(roleText)
}

function getAgentProviderKeywords(agent: AgentRow): string[] {
  const haystack = `${agent.name} ${agent.role} ${agent.runtime_type || ''} ${agent.preferred_runtime || ''}`.toLowerCase()
  const keywords: string[] = []

  if (/(claude|anthropic)/i.test(haystack)) keywords.push('anthropic')
  if (/(codex|openai|chatgpt|gpt-?5|gpt-?4|o3|o4)/i.test(haystack)) keywords.push('openai')
  if (/(gemini|google)/i.test(haystack)) keywords.push('google')
  if (/(grok|xai|x\.ai)/i.test(haystack)) keywords.push('grok')
  if (/(openrouter|router)/i.test(haystack)) keywords.push('openrouter')
  if (/(groq|llama-?3|llama 3)/i.test(haystack)) keywords.push('groq')
  if (/(ollama|local|qwen|mistral|phi-?3|phi-?4)/i.test(haystack)) keywords.push('ollama')

  return uniqueStrings(keywords)
}

function getAgentModelSequence(agent: AgentRow): string[] {
  const config = safeParseJson(agent.config)
  const modelConfig =
    config.model && typeof config.model === 'object' && !Array.isArray(config.model)
      ? (config.model as Record<string, unknown>)
      : {}
  const primary = typeof modelConfig.primary === 'string' ? modelConfig.primary.trim() : ''
  const fallbacks = Array.isArray(modelConfig.fallbacks)
    ? modelConfig.fallbacks.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  return uniqueStrings([primary, ...fallbacks])
}

function getAgentProviderPreference(agent: AgentRow): string[] {
  const modelProviders = getAgentModelSequence(agent).map((model) => normalizeProvider(getProviderFromModel(model)))
  const runtimeProviders = [
    ...(normalizeRuntime(agent.runtime_type) ? (RUNTIME_PROVIDER_HINTS[normalizeRuntime(agent.runtime_type)!] || []) : []),
    ...(normalizeRuntime(agent.preferred_runtime) ? (RUNTIME_PROVIDER_HINTS[normalizeRuntime(agent.preferred_runtime)!] || []) : []),
  ]

  return uniqueStrings([...runtimeProviders, ...modelProviders, ...getAgentProviderKeywords(agent)])
}

function getAgentRuntimePreference(agent: AgentRow): string[] {
  return uniqueStrings([agent.runtime_type, agent.preferred_runtime])
}

function getFallbackModelForProvider(provider: string): string | null {
  return DEFAULT_MODELS_BY_PROVIDER[normalizeProvider(provider)] || null
}

function providerSupportsReasoning(provider: string): boolean {
  const normalized = normalizeProvider(provider)
  return normalized === 'openai' || normalized === 'anthropic' || normalized === 'grok' || normalized === 'groq' || normalized === 'google'
}

function getAccountCapabilityScore(account: Pick<SessionPoolAccountSummary, 'provider' | 'preferredModel' | 'metadata'>): number {
  const providerBaseline: Record<string, number> = {
    anthropic: 82,
    openai: 80,
    google: 78,
    grok: 72,
    openrouter: 74,
    groq: 60,
    ollama: 48,
  }
  const baseline = providerBaseline[normalizeProvider(account.provider)] || 55
  const reasoningBonus = getReasoningEffortRank(getMetadataReasoningEffort(account.metadata)) * 4
  return Math.max(baseline, estimateModelCapability(account.preferredModel)) + reasoningBonus
}

function getAccountEfficiencyBias(provider: string): number {
  switch (normalizeProvider(provider)) {
    case 'ollama':
      return 18
    case 'openrouter':
      return 14
    case 'grok':
      return 10
    case 'groq':
      return 8
    case 'google':
      return 6
    default:
      return 0
  }
}

function computeAgentIntelligenceNeed(
  agent: AgentRow,
  workloadByAgent: Map<string, number>,
): number {
  const models = getAgentModelSequence(agent)
  const modelDemand = models.length > 0
    ? Math.max(...models.map((model, index) => estimateModelCapability(model) - index * 4))
    : 58
  const roleText = `${agent.name} ${agent.role}`.toLowerCase()
  let roleBonus = 0

  if (/(architect|security|review|qa|research|planner|debug|manager|director|lead|ceo|cto|coordinator)/i.test(roleText)) roleBonus += 16
  else if (/(developer|engineer|analyst|codex|claude)/i.test(roleText)) roleBonus += 8
  else if (/(protocol droid|notifier|api access|relay|bridge|assistant)/i.test(roleText)) roleBonus -= 8

  const workload = Math.min(18, workloadByAgent.get(normalizeLower(agent.name)) || 0)
  const runtimeBonus = normalizeRuntime(agent.runtime_type) === 'codex' || normalizeRuntime(agent.preferred_runtime) === 'codex'
    ? 5
    : normalizeRuntime(agent.runtime_type) === 'claude' || normalizeRuntime(agent.preferred_runtime) === 'claude'
      ? 4
      : 0

  return Math.max(35, Math.min(100, modelDemand + roleBonus + Math.min(10, workload) + runtimeBonus))
}

function suggestReasoningEffortForAgentAccount(
  agentNeed: number,
  account: Pick<SessionPoolAccountSummary, 'provider' | 'preferredModel' | 'metadata'>,
): SessionReasoningEffort | null {
  if (!providerSupportsReasoning(account.provider)) return null

  const accountSetting = getMetadataReasoningEffort(account.metadata)
  if (accountSetting) return accountSetting

  const modelCapability = estimateModelCapability(account.preferredModel)
  const effectiveNeed = Math.max(agentNeed, Math.min(100, modelCapability))

  if (effectiveNeed >= 92) return normalizeProvider(account.provider) === 'openai' ? 'xhigh' : 'high'
  if (effectiveNeed >= 80) return 'high'
  if (effectiveNeed >= 64) return 'medium'
  return 'low'
}

function computeCapabilityAlignmentScore(agentNeed: number, accountCapability: number, mode: SessionAllocationMode): number {
  const shortfall = Math.max(0, agentNeed - accountCapability)
  const excess = Math.max(0, accountCapability - agentNeed - 12)
  const shortfallPenaltyMultiplier = mode === 'primary' ? 3.2 : 1.7
  const excessPenaltyMultiplier = mode === 'primary' ? 0.45 : 0.2
  return (Math.min(agentNeed, accountCapability) * 0.7) - (shortfall * shortfallPenaltyMultiplier) - (excess * excessPenaltyMultiplier)
}

function computeStrategicCapabilityBonus(agentNeed: number, accountCapability: number, mode: SessionAllocationMode): number {
  if (mode !== 'primary' || agentNeed < 72) return 0
  return Math.max(0, accountCapability - agentNeed) * 1.5
}

function computeEfficiencyPlacementAdjustment(
  agentNeed: number,
  account: Pick<SessionPoolAccountSummary, 'provider' | 'preferredModel' | 'metadata'>,
  mode: SessionAllocationMode,
): number {
  if (mode !== 'primary' || agentNeed >= 72) return 0
  const accountCapability = getAccountCapabilityScore(account)
  const excess = Math.max(0, accountCapability - agentNeed - 4)
  return getAccountEfficiencyBias(account.provider) - excess * 1.4
}

function computeHeadroomScore(account: SessionPoolAccountSummary): number {
  if (account.usage.maxLimitPct == null) return 26
  return Math.max(-60, (100 - account.usage.maxLimitPct) * 0.32 - 8)
}

function computeFallbackDiversityBonus(
  primary: Pick<SessionPoolAccountSummary, 'id' | 'provider' | 'runtimeType' | 'credentialRef'>,
  candidate: Pick<SessionPoolAccountSummary, 'id' | 'provider' | 'runtimeType' | 'credentialRef'>,
): number {
  if (primary.id === candidate.id) return -10_000

  let bonus = 0
  if (normalizeProvider(primary.provider) !== normalizeProvider(candidate.provider)) bonus += 24
  if (normalizeRuntime(primary.runtimeType) !== normalizeRuntime(candidate.runtimeType)) bonus += 10
  if (String(primary.credentialRef || '').trim() !== String(candidate.credentialRef || '').trim()) bonus += 8
  return bonus
}

export function suggestModelForAgentAccount(
  agent: Pick<AgentRow, 'config' | 'runtime_type' | 'preferred_runtime'>,
  account: Pick<SessionPoolAccountRow, 'provider' | 'preferred_model'>,
): string | null {
  if (account.preferred_model) return account.preferred_model

  const fauxAgent: AgentRow = {
    id: 0,
    name: '',
    role: '',
    status: 'idle',
    config: agent.config ?? null,
    runtime_type: agent.runtime_type ?? null,
    preferred_runtime: agent.preferred_runtime ?? null,
  }

  const provider = normalizeProvider(account.provider)
  for (const model of getAgentModelSequence(fauxAgent)) {
    if (normalizeProvider(getProviderFromModel(model)) === provider) return model
  }

  return getFallbackModelForProvider(provider)
}

function getUsageLimits(account: SessionPoolAccountRow, usage: SessionPoolAccountUsage) {
  const ratios = [usage.monthlyBudgetPct, usage.dailyTokenPct, usage.dailyRequestPct]
    .filter((value): value is number => value != null && Number.isFinite(value))

  const maxLimitPct = ratios.length > 0 ? Math.max(...ratios) : null
  const softLimit = clampPercent(account.soft_limit_pct, 80)
  const hardLimit = Math.max(softLimit, clampPercent(account.hard_limit_pct, 95))
  return { maxLimitPct, softLimit, hardLimit }
}

export function deriveSessionPoolHealth(
  account: Pick<
    SessionPoolAccountRow,
    | 'enabled'
    | 'status'
    | 'consecutive_failures'
    | 'last_success_at'
    | 'last_failure_at'
    | 'cooldown_until'
    | 'soft_limit_pct'
    | 'hard_limit_pct'
  >,
  usage: SessionPoolAccountUsage,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): SessionPoolAccountHealth {
  if (!account.enabled || normalizeLower(account.status) === 'disabled') {
    return {
      state: 'disabled',
      reason: 'disabled',
      consecutiveFailures: account.consecutive_failures,
      lastSuccessAt: account.last_success_at,
      lastFailureAt: account.last_failure_at,
      cooldownUntil: account.cooldown_until,
    }
  }

  if (account.cooldown_until && account.cooldown_until > nowEpochSeconds) {
    return {
      state: 'cooldown',
      reason: 'cooldown',
      consecutiveFailures: account.consecutive_failures,
      lastSuccessAt: account.last_success_at,
      lastFailureAt: account.last_failure_at,
      cooldownUntil: account.cooldown_until,
    }
  }

  const { maxLimitPct, softLimit, hardLimit } = getUsageLimits(account as SessionPoolAccountRow, usage)
  if (maxLimitPct != null && maxLimitPct >= hardLimit) {
    return {
      state: 'exhausted',
      reason: 'usage_limit',
      consecutiveFailures: account.consecutive_failures,
      lastSuccessAt: account.last_success_at,
      lastFailureAt: account.last_failure_at,
      cooldownUntil: account.cooldown_until,
    }
  }

  if (normalizeLower(account.status) === 'failed' || account.consecutive_failures >= 3) {
    return {
      state: 'failed',
      reason: 'repeated_failures',
      consecutiveFailures: account.consecutive_failures,
      lastSuccessAt: account.last_success_at,
      lastFailureAt: account.last_failure_at,
      cooldownUntil: account.cooldown_until,
    }
  }

  if (normalizeLower(account.status) === 'degraded' || (maxLimitPct != null && maxLimitPct >= softLimit)) {
    return {
      state: 'warning',
      reason: normalizeLower(account.status) === 'degraded' ? 'degraded' : 'approaching_limit',
      consecutiveFailures: account.consecutive_failures,
      lastSuccessAt: account.last_success_at,
      lastFailureAt: account.last_failure_at,
      cooldownUntil: account.cooldown_until,
    }
  }

  return {
    state: 'healthy',
    reason: 'available',
    consecutiveFailures: account.consecutive_failures,
    lastSuccessAt: account.last_success_at,
    lastFailureAt: account.last_failure_at,
    cooldownUntil: account.cooldown_until,
  }
}

function loadAccounts(workspaceId: number): SessionPoolAccountRow[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT *
    FROM ai_session_accounts
    WHERE workspace_id = ?
    ORDER BY priority DESC, weight DESC, label ASC
  `).all(workspaceId) as SessionPoolAccountRow[]
}

function loadAllocations(workspaceId: number): SessionPoolAllocationRow[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT *
    FROM ai_session_allocations
    WHERE workspace_id = ?
    ORDER BY agent_id ASC, rank ASC
  `).all(workspaceId) as SessionPoolAllocationRow[]
}

function loadAgents(workspaceId: number): AgentRow[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT id, name, role, status, hidden, config, runtime_type, preferred_runtime
    FROM agents
    WHERE workspace_id = ?
      AND COALESCE(hidden, 0) = 0
    ORDER BY name ASC
  `).all(workspaceId) as AgentRow[]
}

function loadRecentEvents(workspaceId: number, limit: number): SessionPoolEventRow[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT *
    FROM ai_session_events
    WHERE workspace_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(workspaceId, limit) as SessionPoolEventRow[]
}

function loadUsageByAgent(workspaceId: number): Map<string, AgentUsageStats> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const oneDayAgo = now - 24 * 60 * 60
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60

  const columns = new Set(
    (db.prepare(`PRAGMA table_info(token_usage)`).all() as Array<{ name: string }>).map((column) => column.name)
  )
  const agentExpr = columns.has('agent_name') ? `COALESCE(agent_name, '')` : `''`
  const costExpr = columns.has('cost_usd') ? `COALESCE(cost_usd, 0)` : `0`
  const tokenExpr = columns.has('total_tokens')
    ? `COALESCE(total_tokens, 0)`
    : `COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)`

  const rows = db.prepare(`
    SELECT
      ${agentExpr} as agent_name,
      SUM(CASE WHEN created_at >= ? THEN ${costExpr} ELSE 0 END) as cost_30d,
      SUM(CASE WHEN created_at >= ? THEN ${tokenExpr} ELSE 0 END) as tokens_30d,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as requests_30d,
      SUM(CASE WHEN created_at >= ? THEN ${tokenExpr} ELSE 0 END) as tokens_1d,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as requests_1d
    FROM token_usage
    WHERE workspace_id = ?
    GROUP BY ${agentExpr}
  `).all(thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo, oneDayAgo, oneDayAgo, workspaceId) as Array<{
    agent_name: string
    cost_30d: number
    tokens_30d: number
    requests_30d: number
    tokens_1d: number
    requests_1d: number
  }>

  return new Map(rows.map((row) => [
    normalizeLower(row.agent_name),
    {
      cost30d: Number(row.cost_30d || 0),
      requestCount30d: Number(row.requests_30d || 0),
      totalTokens30d: Number(row.tokens_30d || 0),
      totalTokens1d: Number(row.tokens_1d || 0),
      requestCount1d: Number(row.requests_1d || 0),
    },
  ]))
}

function loadWorkloadByAgent(workspaceId: number): Map<string, number> {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT
      COALESCE(assigned_to, '') as assigned_to,
      SUM(CASE WHEN status IN ('assigned', 'in_progress', 'review', 'quality_review') THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count
    FROM tasks
    WHERE workspace_id = ?
    GROUP BY COALESCE(assigned_to, '')
  `).all(workspaceId) as Array<{
    assigned_to: string
    active_count: number
    in_progress_count: number
  }>

  return new Map(rows.map((row) => [
    normalizeLower(row.assigned_to),
    Number(row.active_count || 0) * 2 + Number(row.in_progress_count || 0) * 3,
  ]))
}

function buildAccountUsage(
  account: SessionPoolAccountRow,
  primaryAgents: AgentRow[],
  usageByAgent: Map<string, AgentUsageStats>,
): SessionPoolAccountUsage {
  const totals = primaryAgents.reduce((acc, agent) => {
    const usage = usageByAgent.get(normalizeLower(agent.name))
    if (!usage) return acc
    acc.cost30d += usage.cost30d
    acc.requestCount30d += usage.requestCount30d
    acc.totalTokens30d += usage.totalTokens30d
    acc.totalTokens1d += usage.totalTokens1d
    acc.requestCount1d += usage.requestCount1d
    return acc
  }, {
    cost30d: 0,
    requestCount30d: 0,
    totalTokens30d: 0,
    totalTokens1d: 0,
    requestCount1d: 0,
  })

  const monthlyBudgetPct = account.monthly_budget_usd && account.monthly_budget_usd > 0
    ? (totals.cost30d / account.monthly_budget_usd) * 100
    : null
  const dailyTokenPct = account.daily_token_limit && account.daily_token_limit > 0
    ? (totals.totalTokens1d / account.daily_token_limit) * 100
    : null
  const dailyRequestPct = account.daily_request_limit && account.daily_request_limit > 0
    ? (totals.requestCount1d / account.daily_request_limit) * 100
    : null
  const ratios = [monthlyBudgetPct, dailyTokenPct, dailyRequestPct]
    .filter((value): value is number => value != null && Number.isFinite(value))

  return {
    ...totals,
    monthlyBudgetPct,
    dailyTokenPct,
    dailyRequestPct,
    maxLimitPct: ratios.length > 0 ? Math.max(...ratios) : null,
  }
}

function computeAgentWorkload(agent: AgentRow, workloadByAgent: Map<string, number>): number {
  const taskScore = workloadByAgent.get(normalizeLower(agent.name)) || 0
  const statusBonus = normalizeLower(agent.status) === 'busy' ? 5 : normalizeLower(agent.status) === 'idle' ? 1 : 0
  return taskScore + statusBonus
}

function buildAccountSummary(
  account: SessionPoolAccountRow,
  allAgents: AgentRow[],
  primaryAllocations: SessionPoolAllocationRow[],
  fallbackAllocations: SessionPoolAllocationRow[],
  usageByAgent: Map<string, AgentUsageStats>,
): SessionPoolAccountSummary {
  const primaryAgents = primaryAllocations
    .map((allocation) => allAgents.find((agent) => agent.id === allocation.agent_id))
    .filter((agent): agent is AgentRow => Boolean(agent))
  const fallbackAgents = fallbackAllocations
    .map((allocation) => allAgents.find((agent) => agent.id === allocation.agent_id))
    .filter((agent): agent is AgentRow => Boolean(agent))
  const usage = buildAccountUsage(account, primaryAgents, usageByAgent)
  const health = deriveSessionPoolHealth(account, usage)

  return {
    id: account.id,
    label: account.label,
    provider: account.provider,
    runtimeType: account.runtime_type,
    preferredModel: account.preferred_model,
    credentialRef: account.credential_ref,
    status: account.status,
    enabled: account.enabled === 1,
    priority: account.priority,
    weight: account.weight,
    maxAgents: account.max_agents,
    softLimitPct: clampPercent(account.soft_limit_pct, 80),
    hardLimitPct: clampPercent(account.hard_limit_pct, 95),
    monthlyBudgetUsd: account.monthly_budget_usd,
    dailyTokenLimit: account.daily_token_limit,
    dailyRequestLimit: account.daily_request_limit,
    notes: account.notes,
    metadata: safeParseJson(account.metadata),
    health,
    usage,
    allocationCounts: {
      primary: primaryAgents.length,
      fallback: fallbackAgents.length,
      total: primaryAgents.length + fallbackAgents.length,
    },
    primaryAgents: primaryAgents.map((agent) => ({ id: agent.id, name: agent.name, status: agent.status })),
    fallbackAgents: fallbackAgents.map((agent) => ({ id: agent.id, name: agent.name, status: agent.status })),
  }
}

function computeAccountFitScore(
  agent: AgentRow,
  account: SessionPoolAccountSummary,
  primaryCounts: Map<number, number>,
  resourcePrimaryCounts: Map<string, number>,
  mode: SessionAllocationMode,
  agentNeed: number,
): number {
  let score = account.priority * 10 + account.weight
  const accountCapability = getAccountCapabilityScore(account)
  const normalizedProvider = normalizeProvider(account.provider)
  const normalizedRuntime = normalizeRuntime(account.runtimeType)

  const providerPrefs = getAgentProviderPreference(agent)
  const runtimePrefs = getAgentRuntimePreference(agent)
  const providerIndex = providerPrefs.indexOf(normalizedProvider)
  const runtimeIndex = account.runtimeType ? runtimePrefs.indexOf(normalizedRuntime || '') : -1

  if (providerIndex >= 0) score += 140 - providerIndex * 18
  if (runtimeIndex >= 0) score += 50 - runtimeIndex * 10
  if (account.preferredModel) score += 15
  score += computeCapabilityAlignmentScore(agentNeed, accountCapability, mode)
  score += computeStrategicCapabilityBonus(agentNeed, accountCapability, mode)
  score += computeEfficiencyPlacementAdjustment(agentNeed, account, mode)
  score += computeHeadroomScore(account)

  const healthBonus: Record<SessionPoolHealthState, number> = {
    healthy: 30,
    warning: mode === 'primary' ? -65 : -15,
    cooldown: -400,
    failed: -500,
    disabled: -1000,
    exhausted: -700,
  }
  score += healthBonus[account.health.state]

  if (mode === 'primary') {
    const resourceKey = getSessionResourceKey(account.provider, account.runtimeType, account.credentialRef, account.id)
    score -= (resourcePrimaryCounts.get(resourceKey) || 0) * 8
  }

  if (account.maxAgents && mode === 'primary') {
    const currentCount = primaryCounts.get(account.id) || 0
    if (currentCount >= account.maxAgents) return -10_000
    score -= currentCount * 18
  }

  if (account.usage.maxLimitPct != null) score -= account.usage.maxLimitPct * (mode === 'primary' ? 0.85 : 0.45)

  if (isManagementTierAgent(agent)) {
    if (mode === 'primary') {
      if (normalizedProvider === 'openai') score += 2_200
      else if (normalizedProvider === 'anthropic') score += 260
      else if (normalizedProvider === 'openrouter') score -= 900
      else score -= 460
      if (normalizedRuntime === 'codex') score += 480
    } else {
      if (normalizedProvider === 'openai') score += 420
      else if (normalizedProvider === 'anthropic') score += 120
      else if (normalizedProvider === 'openrouter') score -= 140
      else score -= 70
      if (normalizedRuntime === 'codex') score += 140
    }

    if (accountCapability < 76) score -= mode === 'primary' ? 90 : 40
  }

  return score
}

function writeAllocations(
  workspaceId: number,
  allocations: Array<{
    agentId: number
    accountId: number
    allocationMode: SessionAllocationMode
    rank: number
    assignedReason: string
    metadata: Record<string, unknown>
  }>,
) {
  const db = getDatabase()
  const removeStmt = db.prepare('DELETE FROM ai_session_allocations WHERE workspace_id = ?')
  const insertStmt = db.prepare(`
    INSERT INTO ai_session_allocations (
      workspace_id, agent_id, account_id, allocation_mode, rank, assigned_reason, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `)

  db.transaction(() => {
    removeStmt.run(workspaceId)
    for (const allocation of allocations) {
      insertStmt.run(
        workspaceId,
        allocation.agentId,
        allocation.accountId,
        allocation.allocationMode,
        allocation.rank,
        allocation.assignedReason,
        JSON.stringify(allocation.metadata || {}),
      )
    }
  })()
}

export function logSessionPoolEvent(workspaceId: number, input: {
  accountId?: number | null
  agentId?: number | null
  eventType: string
  detail?: Record<string, unknown>
}) {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO ai_session_events (workspace_id, account_id, agent_id, event_type, detail, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(
    workspaceId,
    input.accountId ?? null,
    input.agentId ?? null,
    input.eventType,
    JSON.stringify(input.detail || {}),
  )
}

export function rebalanceSessionPool(workspaceId: number): { allocationCount: number; protectedAgentCount: number } {
  const accounts = loadAccounts(workspaceId)
  const agents = loadAgents(workspaceId)
  if (accounts.length === 0 || agents.length === 0) {
    writeAllocations(workspaceId, [])
    return { allocationCount: 0, protectedAgentCount: 0 }
  }

  const currentAllocations = loadAllocations(workspaceId)
  const usageByAgent = loadUsageByAgent(workspaceId)
  const workloadByAgent = loadWorkloadByAgent(workspaceId)
  const accountSummaries = accounts.map((account) => buildAccountSummary(
    account,
    agents,
    currentAllocations.filter((allocation) => allocation.account_id === account.id && allocation.allocation_mode === 'primary'),
    currentAllocations.filter((allocation) => allocation.account_id === account.id && allocation.allocation_mode === 'fallback'),
    usageByAgent,
  ))

  const primaryCounts = new Map<number, number>()
  const resourcePrimaryCounts = new Map<string, number>()
  const nextAllocations: Array<{
    agentId: number
    accountId: number
    allocationMode: SessionAllocationMode
    rank: number
    assignedReason: string
    metadata: Record<string, unknown>
  }> = []

  const sortedAgents = [...agents].sort((left, right) => {
    const leftNeed = computeAgentIntelligenceNeed(left, workloadByAgent)
    const rightNeed = computeAgentIntelligenceNeed(right, workloadByAgent)
    return rightNeed - leftNeed || computeAgentWorkload(right, workloadByAgent) - computeAgentWorkload(left, workloadByAgent)
  })
  for (const agent of sortedAgents) {
    const agentNeed = computeAgentIntelligenceNeed(agent, workloadByAgent)
    const viablePrimary = [...accountSummaries]
      .filter((account) => !['disabled', 'failed', 'cooldown', 'exhausted'].includes(account.health.state))
      .sort((left, right) => computeAccountFitScore(agent, right, primaryCounts, resourcePrimaryCounts, 'primary', agentNeed) - computeAccountFitScore(agent, left, primaryCounts, resourcePrimaryCounts, 'primary', agentNeed))

    const primary = viablePrimary[0]
    if (!primary) continue
    const primaryReasoningEffort = suggestReasoningEffortForAgentAccount(agentNeed, primary)
    const primaryResourceKey = getSessionResourceKey(primary.provider, primary.runtimeType, primary.credentialRef, primary.id)

    nextAllocations.push({
      agentId: agent.id,
      accountId: primary.id,
      allocationMode: 'primary',
      rank: 0,
      assignedReason: 'best_fit_primary',
      metadata: {
        suggestedModel: suggestModelForAgentAccount(agent, {
          provider: primary.provider,
          preferred_model: primary.preferredModel,
        }),
        reasoningEffort: primaryReasoningEffort,
        provider: primary.provider,
        capabilityScore: getAccountCapabilityScore(primary),
        intelligenceNeed: agentNeed,
      },
    })
    primaryCounts.set(primary.id, (primaryCounts.get(primary.id) || 0) + 1)
    resourcePrimaryCounts.set(primaryResourceKey, (resourcePrimaryCounts.get(primaryResourceKey) || 0) + 1)

    const fallbackCandidatesByResource = new Map<string, SessionPoolAccountSummary>()
    accountSummaries
      .filter((account) => account.id !== primary.id)
      .filter((account) => !['disabled', 'failed', 'cooldown', 'exhausted'].includes(account.health.state))
      .sort((left, right) => (
        computeAccountFitScore(agent, right, primaryCounts, resourcePrimaryCounts, 'fallback', agentNeed) +
        computeFallbackDiversityBonus(primary, right)
      ) - (
        computeAccountFitScore(agent, left, primaryCounts, resourcePrimaryCounts, 'fallback', agentNeed) +
        computeFallbackDiversityBonus(primary, left)
      ))
      .forEach((account) => {
        const resourceKey = getSessionResourceKey(account.provider, account.runtimeType, account.credentialRef, account.id)
        if (resourceKey === primaryResourceKey || fallbackCandidatesByResource.has(resourceKey)) return
        fallbackCandidatesByResource.set(resourceKey, account)
      })

    const fallbackCandidates = Array.from(fallbackCandidatesByResource.values()).slice(0, 3)

    fallbackCandidates.forEach((account, index) => {
      const fallbackReasoningEffort = suggestReasoningEffortForAgentAccount(agentNeed, account)
      nextAllocations.push({
        agentId: agent.id,
        accountId: account.id,
        allocationMode: 'fallback',
        rank: index + 1,
        assignedReason: 'fallback_chain',
        metadata: {
          suggestedModel: suggestModelForAgentAccount(agent, {
            provider: account.provider,
            preferred_model: account.preferredModel,
          }),
          reasoningEffort: fallbackReasoningEffort,
          provider: account.provider,
          capabilityScore: getAccountCapabilityScore(account),
          intelligenceNeed: agentNeed,
        },
      })
    })
  }

  writeAllocations(workspaceId, nextAllocations)
  logSessionPoolEvent(workspaceId, {
    eventType: 'rebalance',
    detail: {
      allocationCount: nextAllocations.length,
      protectedAgentCount: new Set(nextAllocations.filter((entry) => entry.allocationMode === 'fallback').map((entry) => entry.agentId)).size,
    },
  })

  return {
    allocationCount: nextAllocations.length,
    protectedAgentCount: new Set(nextAllocations.filter((entry) => entry.allocationMode === 'fallback').map((entry) => entry.agentId)).size,
  }
}

export function markSessionAccountFailure(workspaceId: number, accountId: number, agentId: number | null, reason: string) {
  const db = getDatabase()
  const row = db.prepare('SELECT consecutive_failures FROM ai_session_accounts WHERE id = ? AND workspace_id = ?').get(accountId, workspaceId) as { consecutive_failures?: number } | undefined
  const nextFailures = (row?.consecutive_failures || 0) + 1
  const cooldownUntil = nextFailures >= 2 ? Math.floor(Date.now() / 1000) + 15 * 60 : null

  db.prepare(`
    UPDATE ai_session_accounts
    SET
      status = CASE WHEN ? >= 3 THEN 'failed' ELSE 'degraded' END,
      consecutive_failures = ?,
      last_failure_at = unixepoch(),
      cooldown_until = COALESCE(?, cooldown_until),
      updated_at = unixepoch()
    WHERE id = ? AND workspace_id = ?
  `).run(nextFailures, nextFailures, cooldownUntil, accountId, workspaceId)

  logSessionPoolEvent(workspaceId, {
    accountId,
    agentId,
    eventType: 'dispatch_failure',
    detail: { reason, nextFailures, cooldownUntil },
  })
}

export function markSessionAccountSuccess(workspaceId: number, accountId: number, agentId: number | null) {
  const db = getDatabase()
  db.prepare(`
    UPDATE ai_session_accounts
    SET
      status = CASE WHEN status = 'disabled' THEN status ELSE 'active' END,
      consecutive_failures = 0,
      last_success_at = unixepoch(),
      cooldown_until = NULL,
      updated_at = unixepoch()
    WHERE id = ? AND workspace_id = ?
  `).run(accountId, workspaceId)

  logSessionPoolEvent(workspaceId, {
    accountId,
    agentId,
    eventType: 'dispatch_success',
    detail: {},
  })
}

export function createSessionAccount(workspaceId: number, input: SessionPoolAccountInput): number {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO ai_session_accounts (
      workspace_id, label, provider, runtime_type, preferred_model, credential_ref,
      status, enabled, priority, weight, max_agents, soft_limit_pct, hard_limit_pct,
      monthly_budget_usd, daily_token_limit, daily_request_limit, notes, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    workspaceId,
    input.label.trim(),
    normalizeProvider(input.provider),
    normalizeRuntime(input.runtimeType || null),
    input.preferredModel?.trim() || null,
    input.credentialRef?.trim() || null,
    input.status || 'active',
    input.enabled === false ? 0 : 1,
    Math.floor(input.priority ?? 100),
    Math.max(1, Math.floor(input.weight ?? 1)),
    normalizePositiveInt(input.maxAgents),
    clampPercent(input.softLimitPct ?? 80, 80),
    clampPercent(input.hardLimitPct ?? 95, 95),
    input.monthlyBudgetUsd != null ? Math.max(0, Number(input.monthlyBudgetUsd)) : null,
    normalizePositiveInt(input.dailyTokenLimit),
    normalizePositiveInt(input.dailyRequestLimit),
    input.notes?.trim() || null,
    JSON.stringify(input.metadata || {}),
  )
  return Number(result.lastInsertRowid)
}

export function updateSessionAccount(workspaceId: number, accountId: number, input: Partial<SessionPoolAccountInput>) {
  const db = getDatabase()
  const existing = db.prepare('SELECT * FROM ai_session_accounts WHERE id = ? AND workspace_id = ?').get(accountId, workspaceId) as SessionPoolAccountRow | undefined
  if (!existing) throw new Error('Session account not found')
  const existingMetadata = safeParseJson(existing.metadata)
  const mergedMetadata = input.metadata
    ? Object.fromEntries(
      Object.entries({
        ...existingMetadata,
        ...input.metadata,
      }).filter(([, value]) => value != null && value !== ''),
    )
    : existingMetadata

  const merged: SessionPoolAccountInput = {
    label: input.label ?? existing.label,
    provider: input.provider ?? existing.provider,
    runtimeType: input.runtimeType ?? existing.runtime_type,
    preferredModel: input.preferredModel ?? existing.preferred_model,
    credentialRef: input.credentialRef ?? existing.credential_ref,
    status: (input.status as any) ?? (existing.status as any),
    enabled: input.enabled ?? existing.enabled === 1,
    priority: input.priority ?? existing.priority,
    weight: input.weight ?? existing.weight,
    maxAgents: input.maxAgents ?? existing.max_agents,
    softLimitPct: input.softLimitPct ?? existing.soft_limit_pct,
    hardLimitPct: input.hardLimitPct ?? existing.hard_limit_pct,
    monthlyBudgetUsd: input.monthlyBudgetUsd ?? existing.monthly_budget_usd,
    dailyTokenLimit: input.dailyTokenLimit ?? existing.daily_token_limit,
    dailyRequestLimit: input.dailyRequestLimit ?? existing.daily_request_limit,
    notes: input.notes ?? existing.notes,
    metadata: mergedMetadata,
  }

  db.prepare(`
    UPDATE ai_session_accounts
    SET
      label = ?, provider = ?, runtime_type = ?, preferred_model = ?, credential_ref = ?,
      status = ?, enabled = ?, priority = ?, weight = ?, max_agents = ?,
      soft_limit_pct = ?, hard_limit_pct = ?, monthly_budget_usd = ?,
      daily_token_limit = ?, daily_request_limit = ?, notes = ?, metadata = ?, updated_at = unixepoch()
    WHERE id = ? AND workspace_id = ?
  `).run(
    merged.label.trim(),
    normalizeProvider(merged.provider),
    normalizeRuntime(merged.runtimeType || null),
    merged.preferredModel?.trim() || null,
    merged.credentialRef?.trim() || null,
    merged.status || 'active',
    merged.enabled === false ? 0 : 1,
    Math.floor(merged.priority ?? 100),
    Math.max(1, Math.floor(merged.weight ?? 1)),
    normalizePositiveInt(merged.maxAgents),
    clampPercent(merged.softLimitPct ?? 80, 80),
    clampPercent(merged.hardLimitPct ?? 95, 95),
    merged.monthlyBudgetUsd != null ? Math.max(0, Number(merged.monthlyBudgetUsd)) : null,
    normalizePositiveInt(merged.dailyTokenLimit),
    normalizePositiveInt(merged.dailyRequestLimit),
    merged.notes?.trim() || null,
    JSON.stringify(merged.metadata || {}),
    accountId,
    workspaceId,
  )
}

export function deleteSessionAccount(workspaceId: number, accountId: number) {
  const db = getDatabase()
  db.prepare('DELETE FROM ai_session_accounts WHERE id = ? AND workspace_id = ?').run(accountId, workspaceId)
}

export function listDispatchCandidatesForAgent(workspaceId: number, agentId: number): SessionDispatchCandidate[] {
  const allAllocations = loadAllocations(workspaceId)
  const allocations = allAllocations
    .filter((allocation) => allocation.agent_id === agentId)
    .sort((left, right) => left.rank - right.rank)
  if (allocations.length === 0) return []

  const accounts = loadAccounts(workspaceId)
  const agents = loadAgents(workspaceId)
  const usageByAgent = loadUsageByAgent(workspaceId)
  const accountSummaries = accounts.map((account) => buildAccountSummary(
    account,
    agents,
    allAllocations.filter((allocation) => allocation.account_id === account.id && allocation.allocation_mode === 'primary'),
    allAllocations.filter((allocation) => allocation.account_id === account.id && allocation.allocation_mode === 'fallback'),
    usageByAgent,
  ))
  const accountMap = new Map(accountSummaries.map((account) => [account.id, account]))

  const seenResources = new Set<string>()
  return allocations
    .map((allocation) => {
      const account = accountMap.get(allocation.account_id)
      if (!account) return null
      const metadata = safeParseJson(allocation.metadata)

      return {
        accountId: account.id,
        label: account.label,
        provider: account.provider,
        runtimeType: account.runtimeType,
        preferredModel: account.preferredModel,
        credentialRef: account.credentialRef,
        suggestedModel: typeof metadata.suggestedModel === 'string' ? metadata.suggestedModel : account.preferredModel,
        reasoningEffort: normalizeReasoningEffort(metadata.reasoningEffort) || getMetadataReasoningEffort(account.metadata),
        healthState: account.health.state,
        allocationMode: allocation.allocation_mode,
        rank: allocation.rank,
      }
    })
    .filter((entry) => {
      if (!entry) return false
      const resourceKey = getSessionResourceKey(entry.provider, entry.runtimeType, entry.credentialRef, entry.accountId)
      if (seenResources.has(resourceKey)) return false
      seenResources.add(resourceKey)
      return true
    })
    .filter((entry): entry is SessionDispatchCandidate => Boolean(entry))
}

export function getSessionPoolSnapshot(workspaceId: number): SessionPoolSnapshot {
  const accounts = loadAccounts(workspaceId)
  const agents = loadAgents(workspaceId)
  const allocations = loadAllocations(workspaceId)
  const usageByAgent = loadUsageByAgent(workspaceId)
  const workloadByAgent = loadWorkloadByAgent(workspaceId)
  const events = loadRecentEvents(workspaceId, 40)

  const accountSummaries = accounts.map((account) => buildAccountSummary(
    account,
    agents,
    allocations.filter((allocation) => allocation.account_id === account.id && allocation.allocation_mode === 'primary'),
    allocations.filter((allocation) => allocation.account_id === account.id && allocation.allocation_mode === 'fallback'),
    usageByAgent,
  ))
  const accountMap = new Map(accountSummaries.map((account) => [account.id, account]))

  const agentSummaries = agents.map((agent) => {
    const seenResources = new Set<string>()
    const chain = allocations
      .filter((allocation) => allocation.agent_id === agent.id)
      .sort((left, right) => left.rank - right.rank)
      .map((allocation) => {
        const account = accountMap.get(allocation.account_id)
        if (!account) return null
        const metadata = safeParseJson(allocation.metadata)
        return {
          accountId: account.id,
          label: account.label,
          provider: account.provider,
          runtimeType: account.runtimeType,
          allocationMode: allocation.allocation_mode,
          rank: allocation.rank,
          healthState: account.health.state,
          suggestedModel: typeof metadata.suggestedModel === 'string'
            ? metadata.suggestedModel
            : suggestModelForAgentAccount(agent, { provider: account.provider, preferred_model: account.preferredModel }),
          reasoningEffort: normalizeReasoningEffort(metadata.reasoningEffort) || getMetadataReasoningEffort(account.metadata),
          assignedReason: allocation.assigned_reason,
        }
      })
      .filter((entry) => {
        if (!entry) return false
        const resourceKey = getSessionResourceKey(entry.provider, entry.runtimeType, accountMap.get(entry.accountId)?.credentialRef || null, entry.accountId)
        if (seenResources.has(resourceKey)) return false
        seenResources.add(resourceKey)
        return true
      })
      .filter((entry): entry is SessionPoolAgentAllocation => Boolean(entry))

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      preference: {
        providers: getAgentProviderPreference(agent),
        runtimes: getAgentRuntimePreference(agent),
        models: getAgentModelSequence(agent),
      },
      workloadScore: computeAgentWorkload(agent, workloadByAgent),
      currentPrimaryAccountId: chain.find((entry) => entry.allocationMode === 'primary')?.accountId ?? null,
      allocationChain: chain,
    }
  }).sort((left, right) => right.workloadScore - left.workloadScore || left.name.localeCompare(right.name))

  return {
    summary: {
      accountCount: accountSummaries.length,
      activeCount: accountSummaries.filter((account) => account.health.state === 'healthy').length,
      warningCount: accountSummaries.filter((account) => account.health.state === 'warning').length,
      exhaustedCount: accountSummaries.filter((account) => account.health.state === 'exhausted').length,
      cooldownCount: accountSummaries.filter((account) => account.health.state === 'cooldown').length,
      failedCount: accountSummaries.filter((account) => account.health.state === 'failed').length,
      allocatedAgentCount: agentSummaries.filter((agent) => agent.currentPrimaryAccountId != null).length,
      fallbackProtectedAgentCount: agentSummaries.filter((agent) => agent.allocationChain.some((entry) => entry.allocationMode === 'fallback')).length,
      recentFailoverCount: events.filter((event) => event.event_type === 'failover').length,
    },
    accounts: accountSummaries,
    agents: agentSummaries,
    events: events.map((event) => {
      const account = event.account_id ? accountMap.get(event.account_id) : null
      const agent = event.agent_id ? agents.find((entry) => entry.id === event.agent_id) : null
      return {
        id: event.id,
        accountId: event.account_id,
        accountLabel: account?.label ?? null,
        agentId: event.agent_id,
        agentName: agent?.name ?? null,
        eventType: event.event_type,
        detail: safeParseJson(event.detail),
        createdAt: event.created_at,
      }
    }),
  }
}
