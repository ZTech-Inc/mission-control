import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  callDirectProviderText,
  detectLocalClaudeAuthProfiles,
  detectLocalCodexAuthProfiles,
  supportsDirectCredentialRef,
} from '@/lib/provider-direct'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

describe('detectLocalCodexAuthProfiles', () => {
  it('detects desktop and OpenClaw codex auth profiles', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mc-provider-direct-'))
    try {
      const desktopDir = path.join(tmpDir, '.codex')
      const openclawAgentDir = path.join(tmpDir, '.openclaw', 'agents', 'dev', 'agent')
      await mkdir(desktopDir, { recursive: true })
      await mkdir(openclawAgentDir, { recursive: true })

      const desktopToken = makeJwt({
        exp: 1776761755,
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'desktop-account-id',
          chatgpt_plan_type: 'plus',
        },
        'https://api.openai.com/profile': {
          email: 'desktop@example.com',
        },
      })
      await writeFile(
        path.join(desktopDir, 'auth.json'),
        JSON.stringify({ tokens: { access_token: desktopToken } }),
        'utf8',
      )

      const openclawToken = makeJwt({
        exp: 1776717584,
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'openclaw-account-id',
          chatgpt_plan_type: 'plus',
        },
        'https://api.openai.com/profile': {
          email: 'openclaw@example.com',
        },
      })
      await writeFile(
        path.join(openclawAgentDir, 'auth-profiles.json'),
        JSON.stringify({
          profiles: {
            'openai-codex:default': {
              provider: 'openai-codex',
              access: openclawToken,
              accountId: 'openclaw-account-id',
              managedBy: 'codex-cli',
              expires: 1776717584000,
            },
          },
        }),
        'utf8',
      )

      const profiles = detectLocalCodexAuthProfiles({
        homeDir: tmpDir,
        openclawDir: path.join(tmpDir, '.openclaw'),
      })

      expect(profiles).toHaveLength(2)
      expect(profiles.map((profile) => profile.ref)).toEqual([
        'codex-auth:desktop-default',
        'codex-auth:openclaw:dev:openai-codex:default',
      ])
      expect(profiles[0]?.email).toBe('desktop@example.com')
      expect(profiles[1]?.email).toBe('openclaw@example.com')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('detectLocalClaudeAuthProfiles', () => {
  it('detects desktop and credential OAuth profiles', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mc-provider-direct-claude-'))
    try {
      await mkdir(path.join(tmpDir, '.claude'), { recursive: true })
      await writeFile(
        path.join(tmpDir, '.claude.json'),
        JSON.stringify({
          oauthAccount: {
            emailAddress: 'claude.desktop@example.com',
          },
          subscriptionType: 'max',
        }),
        'utf8',
      )

      const claudeOauthToken = makeJwt({
        exp: 1776761755,
        email: 'claude.oauth@example.com',
      })
      await writeFile(
        path.join(tmpDir, '.claude', '.credentials.json'),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: claudeOauthToken,
            subscriptionType: 'pro',
            expiresAt: 1776761755000,
          },
        }),
        'utf8',
      )

      const profiles = detectLocalClaudeAuthProfiles({
        homeDir: tmpDir,
      })

      expect(profiles).toHaveLength(2)
      expect(profiles.map((profile) => profile.ref)).toEqual([
        'claude-auth:desktop-default',
        'claude-auth:credentials:default',
      ])
      expect(profiles[0]?.email).toBe('claude.desktop@example.com')
      expect(profiles[1]?.email).toBe('claude.oauth@example.com')
      expect(profiles[1]?.plan).toBe('pro')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('supportsDirectCredentialRef', () => {
  it('disables direct use for OAuth-backed refs that need runtime login', () => {
    expect(supportsDirectCredentialRef('openai', 'codex-auth:desktop-default')).toBe(false)
    expect(supportsDirectCredentialRef('anthropic', 'claude-auth:desktop-default')).toBe(false)
  })
})

describe('callDirectProviderText', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.MC_TEST_OPENROUTER_API_KEY
    delete process.env.XAI_API_KEY
    delete process.env.GROK_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.GOOGLE_API_KEY
    delete process.env.GEMINI_API_KEY
  })

  it('uses the OpenAI Responses API with env-backed credentials', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: 'openai ok' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callDirectProviderText({
      provider: 'openai',
      model: 'openai/codex-mini-latest',
      prompt: 'Say hello',
      credentialRef: 'env:OPENAI_API_KEY',
      reasoningEffort: 'xhigh',
    })

    expect(result.text).toBe('openai ok')
    expect(result.model).toBe('codex-mini-latest')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-openai')
    const parsedBody = JSON.parse(String(init.body))
    expect(parsedBody.reasoning).toEqual({ effort: 'high' })
  })

  it('uses the OpenRouter chat completions API with env-backed credentials', async () => {
    process.env.MC_TEST_OPENROUTER_API_KEY = 'sk-test-openrouter'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'openrouter ok' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callDirectProviderText({
      provider: 'openrouter',
      model: 'openrouter/anthropic/claude-sonnet-4',
      prompt: 'Say hello',
      credentialRef: 'env:MC_TEST_OPENROUTER_API_KEY',
    })

    expect(result.text).toBe('openrouter ok')
    expect(result.model).toBe('anthropic/claude-sonnet-4')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-openrouter')
  })

  it('uses the Groq OpenAI-compatible API and maps reasoning effort for supported models', async () => {
    process.env.GROQ_API_KEY = 'sk-test-groq'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'groq ok' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callDirectProviderText({
      provider: 'groq',
      model: 'groq/gpt-oss-120b',
      prompt: 'Say hello',
      credentialRef: 'env:GROQ_API_KEY',
      reasoningEffort: 'high',
    })

    expect(result.text).toBe('groq ok')
    expect(result.model).toBe('gpt-oss-120b')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    const parsedBody = JSON.parse(String(init.body))
    expect(parsedBody.reasoning_effort).toBe('high')
    expect(parsedBody.include_reasoning).toBe(false)
  })

  it('uses the xAI Grok OpenAI-compatible API with XAI_API_KEY', async () => {
    process.env.XAI_API_KEY = 'sk-test-xai'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'grok ok' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callDirectProviderText({
      provider: 'grok',
      model: 'grok/grok-3-mini',
      prompt: 'Say hello',
      credentialRef: 'env:XAI_API_KEY',
      reasoningEffort: 'high',
    })

    expect(result.text).toBe('grok ok')
    expect(result.model).toBe('grok-3-mini')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.x.ai/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-xai')
    const parsedBody = JSON.parse(String(init.body))
    expect(parsedBody.model).toBe('grok-3-mini')
  })

  it('uses the Gemini generateContent API with thinking configuration', async () => {
    process.env.GOOGLE_API_KEY = 'sk-test-google'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'google ok' }],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callDirectProviderText({
      provider: 'google',
      model: 'google/gemini-2.5-flash',
      prompt: 'Say hello',
      system: 'Be concise',
      credentialRef: 'env:GOOGLE_API_KEY',
      reasoningEffort: 'medium',
    })

    expect(result.text).toBe('google ok')
    expect(result.model).toBe('gemini-2.5-flash')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    const parsedBody = JSON.parse(String(init.body))
    expect(parsedBody.generationConfig?.thinkingConfig?.thinkingBudget).toBe(2048)
    expect(parsedBody.system_instruction?.parts?.[0]?.text).toBe('Be concise')
  })
})
