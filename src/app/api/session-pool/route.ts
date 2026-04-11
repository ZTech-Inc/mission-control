import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { getEffectiveEnvValue } from '@/lib/runtime-env'
import { MODEL_CATALOG } from '@/lib/models'
import {
  detectLocalClaudeAuthProfiles,
  detectLocalCodexAuthProfiles,
  detectLocalGoogleAuthProfiles,
} from '@/lib/provider-direct'
import {
  createSessionAccount,
  deleteSessionAccount,
  getSessionPoolSnapshot,
  markSessionAccountFailure,
  markSessionAccountSuccess,
  rebalanceSessionPool,
  updateSessionAccount,
} from '@/lib/session-pool'

const execFileAsync = promisify(execFile)
const CODEX_WINDOWS_APP_ID = 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App'
const CLAUDE_WINDOWS_APP_ID = 'shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude'
const CLAUDE_OAUTH_URL = 'https://claude.ai/login'
const GOOGLE_GCLOUD_OAUTH_URL = 'https://cloud.google.com/sdk/gcloud/reference/auth/application-default/login'
const GROK_XAI_PORTAL_URL = 'https://console.x.ai'

interface SessionProviderModelOption {
  id: string
  label: string
  provider: 'openai' | 'anthropic' | 'openrouter'
  source: 'live' | 'catalog'
  isFree?: boolean
  isPaid?: boolean
}

interface SessionProviderModelOptions {
  openai: SessionProviderModelOption[]
  anthropic: SessionProviderModelOption[]
  openrouter: SessionProviderModelOption[]
  generatedAt: number
}

const FALLBACK_MODELS_BY_PROVIDER: Record<'openai' | 'anthropic' | 'openrouter', string[]> = {
  openai: [
    'gpt-5.4',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'o3',
    'o4-mini',
    'codex-mini-latest',
    'gpt-5.3-codex',
  ],
  anthropic: [
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5',
    'claude-sonnet-4-5',
  ],
  openrouter: [
    'google/gemini-2.5-flash',
    'google/gemma-3-12b-it:free',
    'openai/gpt-4.1-mini',
    'anthropic/claude-sonnet-4',
  ],
}

function normalizeNumber(value: unknown): number | null | undefined {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeReasoningEffort(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null
  if (!['low', 'medium', 'high', 'xhigh'].includes(normalized)) return null
  return normalized
}

function buildAccountMetadata(body: any, options?: { clearReasoning?: boolean }): Record<string, unknown> {
  const metadata = body?.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {}
  const reasoningEffort = normalizeReasoningEffort(body?.reasoningEffort)
  if (reasoningEffort) metadata.reasoningEffort = reasoningEffort
  else if (options?.clearReasoning && body?.reasoningEffort !== undefined) metadata.reasoningEffort = null
  else if ('reasoningEffort' in metadata) delete metadata.reasoningEffort
  return metadata
}

function normalizeOllamaHost(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return 'http://127.0.0.1:11434'
  return trimmed.replace(/\/+$/, '')
}

async function probeOllamaHost(host: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch(`${host}/api/tags`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeProviderModelId(provider: 'openai' | 'anthropic' | 'openrouter', rawId: unknown): string {
  const id = String(rawId || '').trim().replace(/^\/+|\/+$/g, '')
  if (!id) return ''
  if (id.toLowerCase().startsWith(`${provider}/`)) return id
  return `${provider}/${id}`
}

function toUniqueModelOptions(options: SessionProviderModelOption[]): SessionProviderModelOption[] {
  const seen = new Set<string>()
  const result: SessionProviderModelOption[] = []
  for (const option of options) {
    if (!option.id || seen.has(option.id)) continue
    seen.add(option.id)
    result.push(option)
  }
  return result
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

async function fetchJsonWithTimeout(
  url: string,
  init?: Omit<RequestInit, 'signal'>,
  timeoutMs: number = 4500,
): Promise<any | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function getCatalogOptions(provider: 'openai' | 'anthropic' | 'openrouter'): SessionProviderModelOption[] {
  const fromCatalog = MODEL_CATALOG
      .filter((model) => {
        if (provider === 'openrouter') {
          return model.provider === 'openrouter' || model.name.startsWith('openrouter/')
        }
        return model.provider === provider
      })
      .map((model) => {
        const id = normalizeProviderModelId(provider, model.name)
        const freeLike = id.toLowerCase().includes(':free') || model.costPer1k <= 0
        return {
          id,
          label: model.name,
          provider,
          source: 'catalog' as const,
          ...(provider === 'openrouter'
            ? { isFree: freeLike, isPaid: !freeLike }
            : {}),
        }
      })

  const fromFallbackList = (FALLBACK_MODELS_BY_PROVIDER[provider] || []).map((modelId) => {
    const id = normalizeProviderModelId(provider, modelId)
    const freeLike = id.toLowerCase().includes(':free')
    return {
      id,
      label: id,
      provider,
      source: 'catalog' as const,
      ...(provider === 'openrouter'
        ? { isFree: freeLike, isPaid: !freeLike }
        : {}),
    }
  })

  return toUniqueModelOptions([
    ...fromCatalog,
    ...fromFallbackList,
  ])
}

async function getSessionProviderModelOptions(): Promise<SessionProviderModelOptions> {
  const [openAiApiKey, openRouterApiKey, anthropicApiKey] = await Promise.all([
    getEffectiveEnvValue('OPENAI_API_KEY'),
    getEffectiveEnvValue('OPENROUTER_API_KEY'),
    getEffectiveEnvValue('ANTHROPIC_API_KEY'),
  ])

  const [openAiData, anthropicData, openRouterData] = await Promise.all([
    openAiApiKey
      ? fetchJsonWithTimeout('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${openAiApiKey}` },
      })
      : Promise.resolve(null),
    anthropicApiKey
      ? fetchJsonWithTimeout('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': anthropicApiKey, 'anthropic-version': '2023-06-01' },
      })
      : Promise.resolve(null),
    fetchJsonWithTimeout('https://openrouter.ai/api/v1/models', {
      headers: openRouterApiKey ? { Authorization: `Bearer ${openRouterApiKey}` } : undefined,
    }),
  ])

  const openAiLive = toUniqueModelOptions(
    Array.isArray(openAiData?.data)
      ? openAiData.data
        .map((row: any) => {
          const id = normalizeProviderModelId('openai', row?.id)
          if (!id) return null
          return {
            id,
            label: String(row?.id || id),
            provider: 'openai' as const,
            source: 'live' as const,
          }
        })
        .filter((value: SessionProviderModelOption | null): value is SessionProviderModelOption => Boolean(value))
      : [],
  ).sort((a, b) => a.label.localeCompare(b.label))

  const anthropicLive = toUniqueModelOptions(
    Array.isArray(anthropicData?.data)
      ? anthropicData.data
        .map((row: any) => {
          const id = normalizeProviderModelId('anthropic', row?.id)
          if (!id) return null
          return {
            id,
            label: String(row?.display_name || row?.name || row?.id || id),
            provider: 'anthropic' as const,
            source: 'live' as const,
          }
        })
        .filter((value: SessionProviderModelOption | null): value is SessionProviderModelOption => Boolean(value))
      : [],
  ).sort((a, b) => a.label.localeCompare(b.label))

  const openRouterLive = toUniqueModelOptions(
    Array.isArray(openRouterData?.data)
      ? openRouterData.data
        .map((row: any) => {
          const id = normalizeProviderModelId('openrouter', row?.id)
          if (!id) return null
          const promptPrice = parsePrice(row?.pricing?.prompt)
          const completionPrice = parsePrice(row?.pricing?.completion)
          const freeByPrice =
            promptPrice != null && completionPrice != null && promptPrice <= 0 && completionPrice <= 0
          const isFree = String(row?.id || '').toLowerCase().endsWith(':free') || freeByPrice
          const displayName = String(row?.name || row?.id || id)
          return {
            id,
            label: `${displayName}${isFree ? ' (Free)' : ' (Paid)'}`,
            provider: 'openrouter' as const,
            source: 'live' as const,
            isFree,
            isPaid: !isFree,
          }
        })
        .filter((value: SessionProviderModelOption | null): value is SessionProviderModelOption => Boolean(value))
      : [],
  ).sort((a, b) => {
    const freeDelta = Number(Boolean(b.isFree)) - Number(Boolean(a.isFree))
    if (freeDelta !== 0) return freeDelta
    return a.label.localeCompare(b.label)
  })

  return {
    openai: toUniqueModelOptions([
      ...openAiLive,
      ...getCatalogOptions('openai'),
    ]),
    anthropic: toUniqueModelOptions([
      ...anthropicLive,
      ...getCatalogOptions('anthropic'),
    ]),
    openrouter: toUniqueModelOptions([
      ...openRouterLive,
      ...getCatalogOptions('openrouter'),
    ]),
    generatedAt: Date.now(),
  }
}

async function getSessionProviderDiscovery() {
  const [openAiApiKey, openRouterApiKey, anthropicApiKey, googleApiKey, xaiApiKey, grokApiKey, groqApiKey, configuredOllamaHost] = await Promise.all([
    getEffectiveEnvValue('OPENAI_API_KEY'),
    getEffectiveEnvValue('OPENROUTER_API_KEY'),
    getEffectiveEnvValue('ANTHROPIC_API_KEY'),
    getEffectiveEnvValue('GOOGLE_API_KEY'),
    getEffectiveEnvValue('XAI_API_KEY'),
    getEffectiveEnvValue('GROK_API_KEY'),
    getEffectiveEnvValue('GROQ_API_KEY'),
    getEffectiveEnvValue('OLLAMA_HOST'),
  ])

  const ollamaHost = normalizeOllamaHost(configuredOllamaHost)
  const ollamaReachable = await probeOllamaHost(ollamaHost)

  return {
    codexOAuth: detectLocalCodexAuthProfiles({
      homeDir: config.homeDir,
      openclawDir: config.openclawStateDir,
    }),
    claudeOAuth: detectLocalClaudeAuthProfiles({
      homeDir: config.homeDir,
      claudeHome: config.claudeHome,
    }),
    googleOAuth: detectLocalGoogleAuthProfiles({
      homeDir: config.homeDir,
    }),
    directApiKeys: {
      openai: Boolean(openAiApiKey),
      openrouter: Boolean(openRouterApiKey),
      anthropic: Boolean(anthropicApiKey),
      google: Boolean(googleApiKey),
      grok: Boolean(xaiApiKey || grokApiKey),
      groq: Boolean(groqApiKey),
    },
    ollama: {
      host: ollamaHost,
      reachable: ollamaReachable,
    },
    generatedAt: Date.now(),
  }
}

async function launchCodexDesktopAuth() {
  if (process.platform !== 'win32') {
    throw new Error('Codex desktop OAuth launch is currently supported only on Windows')
  }

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Start-Process '${CODEX_WINDOWS_APP_ID}'`,
  ], {
    windowsHide: true,
  })
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

async function launchCommandInNewTerminal(command: string) {
  if (process.platform !== 'win32') {
    throw new Error('CLI launch is currently supported only on Windows')
  }
  const escapedCommand = escapePowerShellSingleQuoted(command)
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Start-Process powershell -ArgumentList '-NoExit','-Command','${escapedCommand}'`,
  ], {
    windowsHide: true,
  })
}

async function launchCodexCliAuth() {
  await launchCommandInNewTerminal('codex login')
}

async function launchClaudeDesktopAuth() {
  if (process.platform !== 'win32') {
    throw new Error('Claude desktop OAuth launch is currently supported only on Windows')
  }

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Start-Process '${CLAUDE_WINDOWS_APP_ID}'`,
  ], {
    windowsHide: true,
  })
}

async function launchClaudeCliAuth() {
  await launchCommandInNewTerminal('claude login')
}

async function launchGoogleCliAuth() {
  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Start-Process 'gcloud' -ArgumentList 'auth','application-default','login'",
    ], {
      windowsHide: true,
    })
    return
  }
  const shell = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const command = 'gcloud auth application-default login'
  if (process.platform === 'darwin') {
    await execFileAsync(shell, ['-a', 'Terminal', command], { windowsHide: true })
    return
  }
  await execFileAsync(shell, [`https://cloud.google.com/sdk/gcloud/reference/auth/application-default/login`], { windowsHide: true })
}

async function launchGeminiCliAuth() {
  await launchCommandInNewTerminal('gemini auth login')
}

async function launchGrokCliAuth() {
  await launchCommandInNewTerminal('grok auth login')
}

type EnforceCodexAccountView = {
  id: number
  label: string
  provider: string
  runtimeType: string | null
  preferredModel: string | null
  credentialRef: string | null
}

function normalizeLower(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function isCodexOAuthCredentialRef(value: unknown): boolean {
  return normalizeLower(value).startsWith('codex-auth:')
}

function isCodexSessionAccount(account: EnforceCodexAccountView): boolean {
  if (normalizeLower(account.provider) !== 'openai') return false

  const runtime = normalizeLower(account.runtimeType)
  const label = normalizeLower(account.label)
  const model = normalizeLower(account.preferredModel)
  const credentialRef = normalizeLower(account.credentialRef)

  return runtime === 'codex' ||
    label.includes('codex') ||
    model.includes('codex') ||
    credentialRef.startsWith('codex-auth:')
}

function selectCodexOAuthRefForAccount(
  account: EnforceCodexAccountView,
  availableRefs: string[],
  indexSeed: number,
): string {
  if (availableRefs.length === 0) return 'codex-auth:desktop-default'

  const label = normalizeLower(account.label)
  const matchedByLabel = availableRefs.find((ref) => {
    const normalizedRef = normalizeLower(ref)
    if (normalizedRef.includes('rainbow') && label.includes('rainbow')) return true
    if (normalizedRef.includes('z15') && label.includes('z15')) return true
    return false
  })
  if (matchedByLabel) return matchedByLabel

  return availableRefs[indexSeed % availableRefs.length]!
}

function enforceExistingCodexAccountsToOAuth(workspaceId: number): {
  updatedCount: number
  skippedCount: number
  updatedAccountIds: number[]
  profileRefs: string[]
} {
  const snapshot = getSessionPoolSnapshot(workspaceId)
  const accounts = snapshot.accounts as EnforceCodexAccountView[]
  const profileRefs = detectLocalCodexAuthProfiles({
    homeDir: config.homeDir,
    openclawDir: config.openclawStateDir,
  }).map((profile) => profile.ref)

  let updateCursor = 0
  let skippedCount = 0
  const updatedAccountIds: number[] = []

  for (const account of accounts) {
    if (!isCodexSessionAccount(account)) continue
    if (isCodexOAuthCredentialRef(account.credentialRef)) {
      skippedCount += 1
      continue
    }

    const oauthRef = selectCodexOAuthRefForAccount(account, profileRefs, updateCursor)
    updateSessionAccount(workspaceId, account.id, {
      credentialRef: oauthRef,
      runtimeType: account.runtimeType || 'codex',
    })
    updatedAccountIds.push(account.id)
    updateCursor += 1
  }

  return {
    updatedCount: updatedAccountIds.length,
    skippedCount,
    updatedAccountIds,
    profileRefs,
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const workspaceId = auth.user.workspace_id ?? 1

  const searchParams = new URL(request.url).searchParams
  const force = searchParams.get('force') === 'true'
  const includeDiscovery = searchParams.get('discovery') === 'true'
  const includeModels = searchParams.get('models') === 'true'
  if (force) rebalanceSessionPool(workspaceId)

  const snapshot = getSessionPoolSnapshot(workspaceId)
  if (!includeDiscovery && !includeModels) return NextResponse.json(snapshot)

  const [discovery, modelOptions] = await Promise.all([
    includeDiscovery ? getSessionProviderDiscovery() : Promise.resolve(null),
    includeModels ? getSessionProviderModelOptions() : Promise.resolve(null),
  ])

  return NextResponse.json({
    ...snapshot,
    ...(discovery ? { discovery } : {}),
    ...(modelOptions ? { modelOptions } : {}),
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const action = String(body?.action || 'create').trim().toLowerCase()

  if (action === 'create') {
    if (!body?.label || !body?.provider) {
      return NextResponse.json({ error: 'label and provider are required' }, { status: 400 })
    }
    const accountId = createSessionAccount(workspaceId, {
      label: String(body.label),
      provider: String(body.provider),
      runtimeType: body.runtimeType ? String(body.runtimeType) : null,
      preferredModel: body.preferredModel ? String(body.preferredModel) : null,
      credentialRef: body.credentialRef ? String(body.credentialRef) : null,
      enabled: body.enabled !== false,
      status: body.status ? String(body.status) as any : 'active',
      priority: normalizeNumber(body.priority) ?? 100,
      weight: normalizeNumber(body.weight) ?? 1,
      maxAgents: normalizeNumber(body.maxAgents) ?? null,
      softLimitPct: normalizeNumber(body.softLimitPct) ?? 80,
      hardLimitPct: normalizeNumber(body.hardLimitPct) ?? 95,
      monthlyBudgetUsd: normalizeNumber(body.monthlyBudgetUsd) ?? null,
      dailyTokenLimit: normalizeNumber(body.dailyTokenLimit) ?? null,
      dailyRequestLimit: normalizeNumber(body.dailyRequestLimit) ?? null,
      notes: body.notes ? String(body.notes) : null,
      metadata: buildAccountMetadata(body),
    })
    const rebalance = rebalanceSessionPool(workspaceId)
    logAuditEvent({
      action: 'session_pool.account_create',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'ai_session_account',
      target_id: accountId,
      detail: { label: body.label, provider: body.provider, rebalance },
    })
    return NextResponse.json({ accountId, rebalance, snapshot: getSessionPoolSnapshot(workspaceId) })
  }

  if (action === 'rebalance') {
    const rebalance = rebalanceSessionPool(workspaceId)
    logAuditEvent({
      action: 'session_pool.rebalance',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: rebalance,
    })
    return NextResponse.json({ rebalance, snapshot: getSessionPoolSnapshot(workspaceId) })
  }

  if (action === 'enforce-codex-oauth') {
    const enforcement = enforceExistingCodexAccountsToOAuth(workspaceId)
    const rebalance = rebalanceSessionPool(workspaceId)
    logAuditEvent({
      action: 'session_pool.enforce_codex_oauth',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: {
        updatedCount: enforcement.updatedCount,
        skippedCount: enforcement.skippedCount,
        updatedAccountIds: enforcement.updatedAccountIds,
        profileRefs: enforcement.profileRefs,
        rebalance,
      },
    })
    return NextResponse.json({
      ok: true,
      enforcement,
      rebalance,
      snapshot: getSessionPoolSnapshot(workspaceId),
    })
  }

  if (action === 'mark-failure') {
    const accountId = Number(body?.accountId)
    if (!Number.isFinite(accountId)) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    markSessionAccountFailure(workspaceId, accountId, Number.isFinite(Number(body?.agentId)) ? Number(body.agentId) : null, String(body?.reason || 'manual'))
    return NextResponse.json({ ok: true, snapshot: getSessionPoolSnapshot(workspaceId) })
  }

  if (action === 'mark-success') {
    const accountId = Number(body?.accountId)
    if (!Number.isFinite(accountId)) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    markSessionAccountSuccess(workspaceId, accountId, Number.isFinite(Number(body?.agentId)) ? Number(body.agentId) : null)
    return NextResponse.json({ ok: true, snapshot: getSessionPoolSnapshot(workspaceId) })
  }

  if (action === 'start-codex-oauth') {
    const forceLaunch = body?.forceLaunch === true
    const launchMode = String(body?.launchMode || 'desktop').trim().toLowerCase()
    const requestedEmail = String(body?.email || '').trim().toLowerCase()
    const profiles = detectLocalCodexAuthProfiles({
      homeDir: config.homeDir,
      openclawDir: config.openclawStateDir,
    })
    const matchedProfile = requestedEmail
      ? profiles.find((profile) => typeof profile.email === 'string' && profile.email.toLowerCase() === requestedEmail) || null
      : profiles[0] || null

    if (matchedProfile && !forceLaunch) {
      return NextResponse.json({
        ok: true,
        launched: false,
        matchedProfile: {
          ref: matchedProfile.ref,
          label: matchedProfile.label,
          email: matchedProfile.email,
          plan: matchedProfile.plan,
          expiresAt: matchedProfile.expiresAt,
        },
        message: 'Existing Codex OAuth profile found on this machine.',
      })
    }

    try {
      if (launchMode === 'cli') {
        await launchCodexCliAuth()
      } else {
        await launchCodexDesktopAuth()
      }
      return NextResponse.json({
        ok: true,
        launched: true,
        launchMode: launchMode === 'cli' ? 'cli' : 'desktop',
        matchedProfile: matchedProfile
          ? {
            ref: matchedProfile.ref,
            label: matchedProfile.label,
            email: matchedProfile.email,
            plan: matchedProfile.plan,
            expiresAt: matchedProfile.expiresAt,
          }
          : null,
        message: launchMode === 'cli'
          ? 'Codex CLI login was launched in a new terminal (`codex login`). Complete Sign in with ChatGPT there; it uses ChatGPT/Codex plan limits.'
          : 'Codex Desktop launch was attempted. Complete Sign in with ChatGPT inside Codex Desktop; it uses ChatGPT/Codex plan limits. Do not reuse old /oauth/authorize links; localhost:1455 callback is app-managed and state-bound.',
      })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Failed to launch Codex OAuth flow',
      }, { status: 500 })
    }
  }

  if (action === 'start-claude-oauth') {
    const forceLaunch = body?.forceLaunch === true
    const launchMode = String(body?.launchMode || 'desktop').trim().toLowerCase()
    const requestedEmail = String(body?.email || '').trim().toLowerCase()
    const profiles = detectLocalClaudeAuthProfiles({
      homeDir: config.homeDir,
      claudeHome: config.claudeHome,
    })
    const matchedProfile = requestedEmail
      ? profiles.find((profile) => typeof profile.email === 'string' && profile.email.toLowerCase() === requestedEmail) || null
      : profiles[0] || null

    if (matchedProfile && !forceLaunch) {
      return NextResponse.json({
        ok: true,
        launched: false,
        oauthUrl: CLAUDE_OAUTH_URL,
        matchedProfile: {
          ref: matchedProfile.ref,
          label: matchedProfile.label,
          email: matchedProfile.email,
          plan: matchedProfile.plan,
          expiresAt: matchedProfile.expiresAt,
        },
        message: 'Existing Claude OAuth profile found on this machine.',
      })
    }

    try {
      if (launchMode === 'cli') {
        await launchClaudeCliAuth()
      } else {
        await launchClaudeDesktopAuth()
      }
      return NextResponse.json({
        ok: true,
        launched: true,
        launchMode: launchMode === 'cli' ? 'cli' : 'desktop',
        oauthUrl: CLAUDE_OAUTH_URL,
        matchedProfile: matchedProfile
          ? {
            ref: matchedProfile.ref,
            label: matchedProfile.label,
            email: matchedProfile.email,
            plan: matchedProfile.plan,
            expiresAt: matchedProfile.expiresAt,
          }
          : null,
        message: launchMode === 'cli'
          ? 'Claude CLI login was launched in a new terminal (`claude login`). Complete OAuth there, then return and refresh setup status.'
          : 'Claude Desktop launch was attempted. Continue in the OAuth tab, complete sign-in, then return here.',
      })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Failed to launch Claude OAuth flow',
      }, { status: 500 })
    }
  }

  if (action === 'start-google-oauth') {
    const forceLaunch = body?.forceLaunch === true
    const launchMode = String(body?.launchMode || 'gemini-cli').trim().toLowerCase()
    const profiles = detectLocalGoogleAuthProfiles({
      homeDir: config.homeDir,
    })
    const matchedProfile = profiles[0] || null
    if (matchedProfile && !forceLaunch) {
      return NextResponse.json({
        ok: true,
        launched: false,
        oauthUrl: GOOGLE_GCLOUD_OAUTH_URL,
        matchedProfile: {
          ref: matchedProfile.ref,
          label: matchedProfile.label,
          email: matchedProfile.email,
          expiresAt: matchedProfile.expiresAt,
        },
        message: 'Existing Google OAuth profile found from gcloud application-default credentials.',
      })
    }
    try {
      if (launchMode === 'gcloud-cli') {
        await launchGoogleCliAuth()
      } else {
        await launchGeminiCliAuth()
      }
      return NextResponse.json({
        ok: true,
        launched: true,
        launchMode: launchMode === 'gcloud-cli' ? 'gcloud-cli' : 'gemini-cli',
        oauthUrl: GOOGLE_GCLOUD_OAUTH_URL,
        matchedProfile: matchedProfile
          ? {
            ref: matchedProfile.ref,
            label: matchedProfile.label,
            email: matchedProfile.email,
            expiresAt: matchedProfile.expiresAt,
          }
          : null,
        message: launchMode === 'gcloud-cli'
          ? 'Google gcloud ADC login was launched in a new terminal. Complete it there, then return here.'
          : 'Gemini CLI login was launched in a new terminal (`gemini auth login`). After sign-in, refresh setup status (profile detection remains based on local Google ADC).',
      })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Failed to launch Google OAuth flow',
      }, { status: 500 })
    }
  }

  if (action === 'start-groq-oauth' || action === 'start-grok-oauth') {
    const launchMode = String(body?.launchMode || 'cli').trim().toLowerCase()
    if (launchMode === 'cli') {
      try {
        await launchGrokCliAuth()
        return NextResponse.json({
          ok: true,
          launched: true,
          launchMode: 'cli',
          oauthUrl: GROK_XAI_PORTAL_URL,
          message: 'Grok (xAI) CLI login was launched in a new terminal (`grok auth login`). If the CLI is unavailable, use the xAI console link to create an API key.',
        })
      } catch (error) {
        return NextResponse.json({
          error: error instanceof Error ? error.message : 'Failed to launch Grok CLI',
        }, { status: 500 })
      }
    }
    return NextResponse.json({
      ok: true,
      launched: false,
      launchMode: 'portal',
      oauthUrl: GROK_XAI_PORTAL_URL,
      message: 'Open xAI console in the OAuth tab, sign in with your X account, and create a dedicated Grok API key for this session.',
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const accountId = Number(body?.accountId)
  if (!Number.isFinite(accountId)) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })

  updateSessionAccount(workspaceId, accountId, {
    label: body.label != null ? String(body.label) : undefined,
    provider: body.provider != null ? String(body.provider) : undefined,
    runtimeType: body.runtimeType != null ? String(body.runtimeType) : undefined,
    preferredModel: body.preferredModel != null ? String(body.preferredModel) : undefined,
    credentialRef: body.credentialRef != null ? String(body.credentialRef) : undefined,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    status: body.status != null ? String(body.status) as any : undefined,
    priority: normalizeNumber(body.priority) ?? undefined,
    weight: normalizeNumber(body.weight) ?? undefined,
    maxAgents: normalizeNumber(body.maxAgents) ?? undefined,
    softLimitPct: normalizeNumber(body.softLimitPct) ?? undefined,
    hardLimitPct: normalizeNumber(body.hardLimitPct) ?? undefined,
    monthlyBudgetUsd: normalizeNumber(body.monthlyBudgetUsd),
    dailyTokenLimit: normalizeNumber(body.dailyTokenLimit),
    dailyRequestLimit: normalizeNumber(body.dailyRequestLimit),
    notes: body.notes != null ? String(body.notes) : undefined,
    metadata: (
      (body?.metadata && typeof body.metadata === 'object') ||
      body?.reasoningEffort !== undefined
    )
      ? buildAccountMetadata(body, { clearReasoning: true })
      : undefined,
  })
  const rebalance = rebalanceSessionPool(workspaceId)
  logAuditEvent({
    action: 'session_pool.account_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    target_type: 'ai_session_account',
    target_id: accountId,
    detail: { rebalance },
  })
  return NextResponse.json({ ok: true, rebalance, snapshot: getSessionPoolSnapshot(workspaceId) })
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const accountId = Number(new URL(request.url).searchParams.get('accountId'))
  if (!Number.isFinite(accountId)) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })

  const workspaceId = auth.user.workspace_id ?? 1
  deleteSessionAccount(workspaceId, accountId)
  const rebalance = rebalanceSessionPool(workspaceId)
  logAuditEvent({
    action: 'session_pool.account_delete',
    actor: auth.user.username,
    actor_id: auth.user.id,
    target_type: 'ai_session_account',
    target_id: accountId,
    detail: { rebalance },
  })
  return NextResponse.json({ ok: true, rebalance, snapshot: getSessionPoolSnapshot(workspaceId) })
}
