import { existsSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getEffectiveEnvValue } from '@/lib/runtime-env'

const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth'
const OPENAI_PROFILE_CLAIM = 'https://api.openai.com/profile'

const DEFAULT_DIRECT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'codex-mini-latest',
  openrouter: 'anthropic/claude-sonnet-4',
  groq: 'llama-3.3-70b-versatile',
  grok: 'grok-3-mini',
  google: 'gemini-2.5-flash',
}

export interface DetectedCodexAuthProfile {
  ref: string
  label: string
  source: 'desktop' | 'openclaw-agent'
  runtimeKey: string
  profileKey: string
  email: string | null
  accountId: string | null
  plan: string | null
  managedBy: string | null
  expiresAt: number | null
}

export interface DetectedClaudeAuthProfile {
  ref: string
  label: string
  source: 'desktop' | 'credentials-oauth'
  profileKey: string
  email: string | null
  plan: string | null
  managedBy: string | null
  expiresAt: number | null
}

export interface DetectedGoogleAuthProfile {
  ref: string
  label: string
  source: 'gcloud-adc'
  profileKey: string
  email: string | null
  expiresAt: number | null
}

export interface ResolvedProviderCredential {
  provider: string
  source: string
  secret: string
  authScheme: 'bearer' | 'x-api-key'
  secretType: 'oauth' | 'api_key'
}

export interface DirectProviderDispatchInput {
  provider: string
  model?: string | null
  prompt: string
  system?: string | null
  credentialRef?: string | null
  reasoningEffort?: string | null
}

export interface DirectProviderDispatchResult {
  text: string | null
  provider: string
  model: string
  credentialSource: string
}

type JwtPayload = Record<string, unknown>

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function decodeJwtPayload(token: string | null | undefined): JwtPayload | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as JwtPayload
  } catch {
    return null
  }
}

function getPayloadString(payload: JwtPayload | null, key: string): string | null {
  if (!payload) return null
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getOpenAIPayloadMeta(payload: JwtPayload | null): {
  email: string | null
  accountId: string | null
  plan: string | null
} {
  const auth = payload?.[OPENAI_AUTH_CLAIM]
  const profile = payload?.[OPENAI_PROFILE_CLAIM]

  const email = profile && typeof profile === 'object' && !Array.isArray(profile)
    ? getPayloadString(profile as JwtPayload, 'email')
    : getPayloadString(payload, 'email')
  const accountId = auth && typeof auth === 'object' && !Array.isArray(auth)
    ? getPayloadString(auth as JwtPayload, 'chatgpt_account_id')
    : getPayloadString(payload, 'account_id')
  const plan = auth && typeof auth === 'object' && !Array.isArray(auth)
    ? getPayloadString(auth as JwtPayload, 'chatgpt_plan_type')
    : getPayloadString(payload, 'plan')

  return { email, accountId, plan }
}

function buildAuthLabel(sourceName: string, email: string | null, accountId: string | null): string {
  const suffix = email || (accountId ? accountId.slice(0, 8) : 'unknown')
  return `${sourceName} (${suffix})`
}

function getGoogleAdcPath(homeDir: string): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
    return path.join(appData, 'gcloud', 'application_default_credentials.json')
  }
  return path.join(homeDir, '.config', 'gcloud', 'application_default_credentials.json')
}

function getGoogleConfigDefaultPath(homeDir: string): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
    return path.join(appData, 'gcloud', 'configurations', 'config_default')
  }
  return path.join(homeDir, '.config', 'gcloud', 'configurations', 'config_default')
}

function readGoogleConfiguredAccount(homeDir: string): string | null {
  const configDefaultPath = getGoogleConfigDefaultPath(homeDir)
  if (!existsSync(configDefaultPath)) return null
  try {
    const contents = readFileSync(configDefaultPath, 'utf8')
    const line = contents
      .split(/\r?\n/)
      .find((entry) => entry.trim().toLowerCase().startsWith('account'))
    if (!line) return null
    const [, value] = line.split('=', 2)
    const normalized = String(value || '').trim()
    return normalized || null
  } catch {
    return null
  }
}

function detectDesktopCodexAuth(homeDir: string): DetectedCodexAuthProfile[] {
  const authPath = path.join(homeDir, '.codex', 'auth.json')
  const auth = readJsonFile<{ tokens?: Record<string, string> }>(authPath)
  const accessToken = auth?.tokens?.access_token || auth?.tokens?.id_token || null
  if (!accessToken) return []

  const payload = decodeJwtPayload(accessToken)
  const meta = getOpenAIPayloadMeta(payload)
  const expiresAt = typeof payload?.exp === 'number' ? payload.exp * 1000 : null

  return [{
    ref: 'codex-auth:desktop-default',
    label: buildAuthLabel('Codex Desktop', meta.email, meta.accountId),
    source: 'desktop',
    runtimeKey: 'desktop',
    profileKey: 'default',
    email: meta.email,
    accountId: meta.accountId,
    plan: meta.plan,
    managedBy: 'codex-desktop',
    expiresAt,
  }]
}

function detectOpenClawCodexAuth(openclawDir: string): DetectedCodexAuthProfile[] {
  const agentsDir = path.join(openclawDir, 'agents')
  if (!existsSync(agentsDir)) return []

  const results: DetectedCodexAuthProfile[] = []
  for (const agentDirName of readdirSync(agentsDir)) {
    const authProfilesPath = path.join(agentsDir, agentDirName, 'agent', 'auth-profiles.json')
    const authProfiles = readJsonFile<{ profiles?: Record<string, {
      provider?: string
      access?: string
      expires?: number
      accountId?: string
      managedBy?: string
    }> }>(authProfilesPath)
    if (!authProfiles?.profiles) continue

    for (const [profileKey, profile] of Object.entries(authProfiles.profiles)) {
      if (!profile?.access) continue
      if (profile.provider && profile.provider !== 'openai-codex') continue

      const payload = decodeJwtPayload(profile.access)
      const meta = getOpenAIPayloadMeta(payload)
      results.push({
        ref: `codex-auth:openclaw:${agentDirName}:${profileKey}`,
        label: buildAuthLabel(`Codex ${agentDirName}`, meta.email, profile.accountId || meta.accountId || null),
        source: 'openclaw-agent',
        runtimeKey: agentDirName,
        profileKey,
        email: meta.email,
        accountId: profile.accountId || meta.accountId || null,
        plan: meta.plan,
        managedBy: profile.managedBy || null,
        expiresAt: typeof profile.expires === 'number' ? profile.expires : null,
      })
    }
  }

  return results
}

export function detectLocalCodexAuthProfiles(options?: {
  homeDir?: string
  openclawDir?: string
}): DetectedCodexAuthProfile[] {
  const homeDir = options?.homeDir || os.homedir()
  const openclawDir = options?.openclawDir || path.join(homeDir, '.openclaw')
  return [
    ...detectDesktopCodexAuth(homeDir),
    ...detectOpenClawCodexAuth(openclawDir),
  ]
}

function detectDesktopClaudeAuth(homeDir: string): DetectedClaudeAuthProfile[] {
  const claudeJsonPath = path.join(homeDir, '.claude.json')
  const claudeJson = readJsonFile<{
    oauthAccount?: { emailAddress?: string }
    subscriptionType?: string
  }>(claudeJsonPath)
  const email =
    typeof claudeJson?.oauthAccount?.emailAddress === 'string' &&
    claudeJson.oauthAccount.emailAddress.trim().length > 0
      ? claudeJson.oauthAccount.emailAddress.trim()
      : null
  if (!email) return []

  const plan =
    typeof claudeJson?.subscriptionType === 'string' && claudeJson.subscriptionType.trim().length > 0
      ? claudeJson.subscriptionType.trim()
      : null

  return [{
    ref: 'claude-auth:desktop-default',
    label: `Claude Desktop (${email})`,
    source: 'desktop',
    profileKey: 'default',
    email,
    plan,
    managedBy: 'claude-cli',
    expiresAt: null,
  }]
}

function detectClaudeCredentialOauth(homeDir: string, claudeHome: string): DetectedClaudeAuthProfile[] {
  const credsPath = path.join(claudeHome, '.credentials.json')
  const creds = readJsonFile<{
    claudeAiOauth?: {
      accessToken?: string
      subscriptionType?: string
      expiresAt?: number
    }
  }>(credsPath)
  const accessToken = creds?.claudeAiOauth?.accessToken || null
  if (!accessToken) return []

  const payload = decodeJwtPayload(accessToken)
  const email =
    getPayloadString(payload, 'email') ||
    getPayloadString(payload, 'emailAddress') ||
    getPayloadString(payload, 'upn')
  const plan =
    typeof creds?.claudeAiOauth?.subscriptionType === 'string' && creds.claudeAiOauth.subscriptionType.trim().length > 0
      ? creds.claudeAiOauth.subscriptionType.trim()
      : getPayloadString(payload, 'subscriptionType')
  const expiresAt =
    typeof creds?.claudeAiOauth?.expiresAt === 'number'
      ? creds.claudeAiOauth.expiresAt
      : typeof payload?.exp === 'number'
        ? payload.exp * 1000
        : null
  const sourceLabel = claudeHome !== path.join(homeDir, '.claude')
    ? path.basename(claudeHome) || 'profile'
    : 'default'

  return [{
    ref: `claude-auth:credentials:${sourceLabel}`,
    label: `Claude OAuth (${email || sourceLabel})`,
    source: 'credentials-oauth',
    profileKey: sourceLabel,
    email,
    plan: plan || null,
    managedBy: 'claude-cli',
    expiresAt,
  }]
}

export function detectLocalClaudeAuthProfiles(options?: {
  homeDir?: string
  claudeHome?: string
}): DetectedClaudeAuthProfile[] {
  const homeDir = options?.homeDir || os.homedir()
  const claudeHome = options?.claudeHome || path.join(homeDir, '.claude')
  return [
    ...detectDesktopClaudeAuth(homeDir),
    ...detectClaudeCredentialOauth(homeDir, claudeHome),
  ]
}

export function detectLocalGoogleAuthProfiles(options?: {
  homeDir?: string
}): DetectedGoogleAuthProfile[] {
  const homeDir = options?.homeDir || os.homedir()
  const adcPath = getGoogleAdcPath(homeDir)
  const creds = readJsonFile<{
    type?: string
    client_id?: string
    client_secret?: string
    refresh_token?: string
  }>(adcPath)
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh_token) return []

  const email = readGoogleConfiguredAccount(homeDir)
  return [{
    ref: `google-auth:gcloud:${email ? email.toLowerCase() : 'default'}`,
    label: `Google ADC (${email || 'default'})`,
    source: 'gcloud-adc',
    profileKey: email ? email.toLowerCase() : 'default',
    email,
    expiresAt: null,
  }]
}

function parseCredentialRef(ref: string | null | undefined):
  | { kind: 'auto' }
  | { kind: 'env'; key: string }
  | { kind: 'codex-desktop' }
  | { kind: 'codex-openclaw'; runtimeKey: string; profileKey: string }
  | { kind: 'claude-oauth' }
  | { kind: 'google-adc'; profileKey: string } {
  const value = String(ref || '').trim()
  if (!value || value === 'auto') return { kind: 'auto' }

  if (/^[A-Z][A-Z0-9_]*$/.test(value)) {
    return { kind: 'env', key: value }
  }
  if (value.startsWith('env:')) {
    return { kind: 'env', key: value.slice(4).trim() }
  }
  if (value === 'codex-auth:desktop-default' || value.startsWith('codex-auth:desktop:')) {
    return { kind: 'codex-desktop' }
  }
  if (value.startsWith('codex-auth:openclaw:')) {
    const remainder = value.slice('codex-auth:openclaw:'.length)
    const [runtimeKey, ...profileParts] = remainder.split(':')
    if (runtimeKey && profileParts.length > 0) {
      return { kind: 'codex-openclaw', runtimeKey, profileKey: profileParts.join(':') }
    }
  }
  if (value.startsWith('claude-auth:')) {
    return { kind: 'claude-oauth' }
  }
  if (value.startsWith('google-auth:gcloud:')) {
    const profileKey = value.slice('google-auth:gcloud:'.length).trim() || 'default'
    return { kind: 'google-adc', profileKey }
  }
  if (value === 'google-auth:gcloud' || value === 'google-auth:desktop-default') {
    return { kind: 'google-adc', profileKey: 'default' }
  }

  return { kind: 'env', key: value }
}

function getDefaultEnvVarForProvider(provider: string): string | null {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY'
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'openrouter':
      return 'OPENROUTER_API_KEY'
    case 'grok':
      return 'XAI_API_KEY'
    case 'groq':
      return 'GROQ_API_KEY'
    case 'google':
      return 'GOOGLE_API_KEY'
    default:
      return null
  }
}

async function resolveEnvCredential(
  provider: string,
  envKey: string,
): Promise<ResolvedProviderCredential | null> {
  const value = await getEffectiveEnvValue(envKey)
  if (!value) return null

  return {
    provider,
    source: `env:${envKey}`,
    secret: value,
    authScheme: provider === 'anthropic' ? 'x-api-key' : 'bearer',
    secretType: 'api_key',
  }
}

async function resolveDefaultProviderCredential(provider: string): Promise<ResolvedProviderCredential | null> {
  if (provider === 'grok') {
    const xaiCredential = await resolveEnvCredential(provider, 'XAI_API_KEY')
    if (xaiCredential) return xaiCredential
    const grokCredential = await resolveEnvCredential(provider, 'GROK_API_KEY')
    if (grokCredential) return grokCredential
    const legacyGroqCredential = await resolveEnvCredential(provider, 'GROQ_API_KEY')
    if (legacyGroqCredential) return legacyGroqCredential
  }
  if (provider === 'google') {
    const googleEnvCredential = await resolveEnvCredential(provider, 'GOOGLE_API_KEY')
    if (googleEnvCredential) return googleEnvCredential
    const geminiEnvCredential = await resolveEnvCredential(provider, 'GEMINI_API_KEY')
    if (geminiEnvCredential) return geminiEnvCredential
  }
  const envKey = getDefaultEnvVarForProvider(provider)
  if (envKey) {
    const envCredential = await resolveEnvCredential(provider, envKey)
    if (envCredential) return envCredential
  }
  return null
}

async function resolveGoogleAdcCredential(profileKey: string): Promise<ResolvedProviderCredential | null> {
  const homeDir = os.homedir()
  const adcPath = getGoogleAdcPath(homeDir)
  const creds = readJsonFile<{
    client_id?: string
    client_secret?: string
    refresh_token?: string
  }>(adcPath)
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh_token) return null

  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => ({}))
  const accessToken = typeof data?.access_token === 'string' ? data.access_token : null
  if (!accessToken) return null

  return {
    provider: 'google',
    source: `google-auth:gcloud:${profileKey}`,
    secret: accessToken,
    authScheme: 'bearer',
    secretType: 'oauth',
  }
}

export async function resolveProviderCredential(
  providerInput: string,
  credentialRef?: string | null,
): Promise<ResolvedProviderCredential | null> {
  const provider = providerInput.trim().toLowerCase()
  const parsed = parseCredentialRef(credentialRef)

  if (parsed.kind === 'auto') {
    return resolveDefaultProviderCredential(provider)
  }

  if (parsed.kind === 'env') {
    return resolveEnvCredential(provider, parsed.key)
  }

  if (parsed.kind === 'google-adc') {
    if (provider !== 'google') return null
    return resolveGoogleAdcCredential(parsed.profileKey)
  }

  if (provider !== 'openai') return null

  if (parsed.kind === 'codex-desktop') {
    return null
  }

  if (parsed.kind === 'claude-oauth') {
    return null
  }

  return null
}

function normalizeDirectModel(provider: string, model: string | null | undefined): string {
  const fallback = DEFAULT_DIRECT_MODELS[provider] || ''
  const raw = String(model || fallback).trim().replace(/^9router\/cc\//, '')
  if (!raw) return fallback

  if (provider === 'openrouter' && raw.startsWith('openrouter/')) {
    return raw.slice('openrouter/'.length)
  }
  if (provider === 'openai' && /^(openai|openai-codex)\//.test(raw)) {
    return raw.split('/').slice(1).join('/')
  }
  if (provider === 'anthropic' && raw.startsWith('anthropic/')) {
    return raw.slice('anthropic/'.length)
  }
  if (provider === 'grok' && raw.startsWith('grok/')) {
    return raw.slice('grok/'.length)
  }
  if (provider === 'groq' && raw.startsWith('groq/')) {
    return raw.slice('groq/'.length)
  }
  if (provider === 'google' && raw.startsWith('google/')) {
    return raw.slice('google/'.length)
  }
  return raw
}

function normalizeReasoningEffort(value: string | null | undefined): 'low' | 'medium' | 'high' | 'xhigh' | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') return normalized
  return null
}

function mapOpenAIReasoningEffort(value: string | null | undefined): 'low' | 'medium' | 'high' | null {
  const normalized = normalizeReasoningEffort(value)
  if (!normalized) return null
  if (normalized === 'xhigh') return 'high'
  return normalized
}

function mapAnthropicEffort(value: string | null | undefined): 'low' | 'medium' | 'high' | null {
  const normalized = normalizeReasoningEffort(value)
  if (!normalized) return null
  if (normalized === 'xhigh') return 'high'
  return normalized
}

function mapGoogleThinkingLevel(value: string | null | undefined): 'minimal' | 'low' | 'medium' | 'high' | null {
  const normalized = normalizeReasoningEffort(value)
  if (!normalized) return null
  if (normalized === 'xhigh') return 'high'
  return normalized
}

function mapGoogleThinkingBudget(value: string | null | undefined): number | null {
  const normalized = normalizeReasoningEffort(value)
  switch (normalized) {
    case 'low':
      return 512
    case 'medium':
      return 2048
    case 'high':
      return 8192
    case 'xhigh':
      return 16384
    default:
      return null
  }
}

function supportsAnthropicAdaptiveThinking(model: string): boolean {
  return /claude-(sonnet|opus)-4-6/i.test(model)
}

function supportsGoogleThinkingLevel(model: string): boolean {
  return /^gemini-3/i.test(model)
}

function supportsGoogleThinkingBudget(model: string): boolean {
  return /^gemini-2\.5/i.test(model)
}

function supportsGroqReasoningEffort(model: string): boolean {
  return /gpt-oss|qwen3|qwq/i.test(model)
}

function mapGroqReasoningEffort(model: string, value: string | null | undefined): 'none' | 'default' | 'low' | 'medium' | 'high' | null {
  const normalized = normalizeReasoningEffort(value)
  if (!normalized || !supportsGroqReasoningEffort(model)) return null
  if (/qwen3|qwq/i.test(model)) {
    if (normalized === 'low') return 'none'
    return 'default'
  }
  if (normalized === 'xhigh') return 'high'
  return normalized
}

function extractTextFromContentBlocks(content: unknown): string | null {
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (!Array.isArray(content)) return null

  const parts = content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const record = block as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.output_text === 'string') return record.output_text
      return ''
    })
    .filter(Boolean)

  return parts.length > 0 ? parts.join('\n').trim() : null
}

function parseAnthropicText(data: any): string | null {
  if (!Array.isArray(data?.content)) return null
  const parts = data.content
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string' && block.text.trim())
    .map((block: any) => block.text.trim())
  return parts.length > 0 ? parts.join('\n') : null
}

function parseOpenAIText(data: any): string | null {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()
  if (!Array.isArray(data?.output)) return null

  for (const item of data.output) {
    const text = extractTextFromContentBlocks(item?.content)
    if (text) return text
  }
  return null
}

function parseOpenRouterText(data: any): string | null {
  const message = data?.choices?.[0]?.message
  const text = extractTextFromContentBlocks(message?.content)
  if (text) return text
  if (typeof message?.content === 'string' && message.content.trim()) return message.content.trim()
  return null
}

function parseGoogleText(data: any): string | null {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  const parts: string[] = []
  for (const candidate of candidates) {
    const contentParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    for (const part of contentParts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        parts.push(part.text.trim())
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

async function callAnthropic(
  model: string,
  credential: ResolvedProviderCredential,
  prompt: string,
  system?: string | null,
  reasoningEffort?: string | null,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  }
  if (system) body.system = system
  const anthropicEffort = mapAnthropicEffort(reasoningEffort)
  if (anthropicEffort) {
    if (supportsAnthropicAdaptiveThinking(model)) {
      body.thinking = { type: 'adaptive' }
      body.output_config = { effort: anthropicEffort }
    } else {
      const budgetTokens = anthropicEffort === 'low' ? 1024 : anthropicEffort === 'medium' ? 4096 : 12288
      body.thinking = { type: 'enabled', budget_tokens: budgetTokens }
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': credential.secret,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${errorBody.substring(0, 500)}`)
  }

  return parseAnthropicText(await res.json())
}

async function callOpenAI(
  model: string,
  credential: ResolvedProviderCredential,
  prompt: string,
  system?: string | null,
  reasoningEffort?: string | null,
): Promise<string | null> {
  const input = [
    ...(system ? [{ role: 'system', content: [{ type: 'input_text', text: system }] }] : []),
    { role: 'user', content: [{ type: 'input_text', text: prompt }] },
  ]

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.secret}`,
    },
    body: JSON.stringify({
      model,
      input,
      max_output_tokens: 4096,
      ...(mapOpenAIReasoningEffort(reasoningEffort)
        ? { reasoning: { effort: mapOpenAIReasoningEffort(reasoningEffort) } }
        : {}),
    }),
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`OpenAI API ${res.status}: ${errorBody.substring(0, 500)}`)
  }

  return parseOpenAIText(await res.json())
}

async function callOpenRouter(
  model: string,
  credential: ResolvedProviderCredential,
  prompt: string,
  system?: string | null,
): Promise<string | null> {
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ]

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.secret}`,
      'HTTP-Referer': 'http://127.0.0.1:3000',
      'X-Title': 'Mission Control',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4096,
    }),
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`OpenRouter API ${res.status}: ${errorBody.substring(0, 500)}`)
  }

  return parseOpenRouterText(await res.json())
}

async function callGroq(
  model: string,
  credential: ResolvedProviderCredential,
  prompt: string,
  system?: string | null,
  reasoningEffort?: string | null,
): Promise<string | null> {
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ]
  const groqReasoningEffort = mapGroqReasoningEffort(model, reasoningEffort)

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.secret}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4096,
      ...(groqReasoningEffort ? { reasoning_effort: groqReasoningEffort, include_reasoning: false } : {}),
    }),
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`Groq API ${res.status}: ${errorBody.substring(0, 500)}`)
  }

  return parseOpenRouterText(await res.json())
}

async function callGrok(
  model: string,
  credential: ResolvedProviderCredential,
  prompt: string,
  system?: string | null,
): Promise<string | null> {
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ]

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.secret}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4096,
    }),
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`Grok API ${res.status}: ${errorBody.substring(0, 500)}`)
  }

  return parseOpenRouterText(await res.json())
}

async function callGoogle(
  model: string,
  credential: ResolvedProviderCredential,
  prompt: string,
  system?: string | null,
  reasoningEffort?: string | null,
): Promise<string | null> {
  const generationConfig: Record<string, unknown> = {}
  const googleThinkingLevel = mapGoogleThinkingLevel(reasoningEffort)
  const googleThinkingBudget = mapGoogleThinkingBudget(reasoningEffort)

  if (googleThinkingLevel && supportsGoogleThinkingLevel(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: googleThinkingLevel }
  } else if (googleThinkingBudget != null && supportsGoogleThinkingBudget(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: googleThinkingBudget }
  }

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  }
  if (system) {
    body.system_instruction = {
      parts: [{ text: system }],
    }
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': credential.secret,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`Google API ${res.status}: ${errorBody.substring(0, 500)}`)
  }

  return parseGoogleText(await res.json())
}

export function supportsDirectProvider(providerInput: string): boolean {
  const provider = providerInput.trim().toLowerCase()
  return provider === 'anthropic' || provider === 'openai' || provider === 'openrouter' || provider === 'grok' || provider === 'groq' || provider === 'google'
}

export function supportsDirectCredentialRef(
  providerInput: string,
  credentialRef?: string | null,
): boolean {
  const provider = providerInput.trim().toLowerCase()
  if (!supportsDirectProvider(provider)) return false

  const ref = String(credentialRef || '').trim()
  if (provider === 'openai' && ref.startsWith('codex-auth:')) {
    return false
  }
  if (provider === 'anthropic' && ref.startsWith('claude-auth:')) {
    return false
  }
  if (provider === 'grok' && ref.startsWith('grok-auth:')) {
    return false
  }
  if (provider === 'groq' && ref.startsWith('groq-auth:')) {
    return false
  }

  return true
}

export async function callDirectProviderText(input: DirectProviderDispatchInput): Promise<DirectProviderDispatchResult> {
  const provider = input.provider.trim().toLowerCase()
  if (!supportsDirectProvider(provider)) {
    throw new Error(`Direct dispatch is not supported for provider: ${provider}`)
  }

  const credential = await resolveProviderCredential(provider, input.credentialRef || null)
  if (!credential) {
    throw new Error(`No credential configured for provider ${provider}${input.credentialRef ? ` (${input.credentialRef})` : ''}`)
  }

  const model = normalizeDirectModel(provider, input.model)
  let text: string | null

  switch (provider) {
    case 'anthropic':
      text = await callAnthropic(model, credential, input.prompt, input.system, input.reasoningEffort)
      break
    case 'openai':
      text = await callOpenAI(model, credential, input.prompt, input.system, input.reasoningEffort)
      break
    case 'openrouter':
      text = await callOpenRouter(model, credential, input.prompt, input.system)
      break
    case 'grok':
      text = await callGrok(model, credential, input.prompt, input.system)
      break
    case 'groq':
      text = await callGroq(model, credential, input.prompt, input.system, input.reasoningEffort)
      break
    case 'google':
      text = await callGoogle(model, credential, input.prompt, input.system, input.reasoningEffort)
      break
    default:
      throw new Error(`Unsupported direct provider: ${provider}`)
  }

  if (!text) {
    throw new Error(`${provider} direct dispatch returned empty text`)
  }

  return {
    text,
    provider,
    model,
    credentialSource: credential.source,
  }
}
