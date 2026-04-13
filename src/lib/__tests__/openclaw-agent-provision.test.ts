import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const runOpenClaw = vi.hoisted(() => vi.fn())
const writeAgentToConfig = vi.hoisted(() => vi.fn())

vi.mock('@/lib/command', () => ({
  runOpenClaw,
}))

vi.mock('@/lib/agent-sync', () => ({
  writeAgentToConfig,
}))

describe('ensureOpenClawAgent', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    vi.resetModules()
    runOpenClaw.mockReset()
    writeAgentToConfig.mockReset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it('provisions missing OpenClaw agents and mirrors AGENT.md into AGENTS.md', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-openclaw-agent-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    const workspaceDir = path.join(tempDir, 'team-agent')
    mkdirSync(workspaceDir, { recursive: true })
    writeFileSync(configPath, JSON.stringify({ agents: { list: [] } }, null, 2) + '\n', 'utf-8')
    writeFileSync(path.join(workspaceDir, 'AGENT.md'), '# Agent Rules\n\nUse the workspace context.\n', 'utf-8')

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    runOpenClaw.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    writeAgentToConfig.mockResolvedValue(undefined)

    const { ensureOpenClawAgent } = await import('@/lib/openclaw-agent-provision')
    const result = await ensureOpenClawAgent({
      agentName: 'Agent Evaluation Specialist',
      agentConfigRaw: JSON.stringify({ workspace: workspaceDir }),
      soulContent: '# Soul\n\nReview work critically.\n',
    })

    expect(result).toEqual({
      agentId: 'agent-evaluation-specialist',
      created: true,
      workspace: workspaceDir,
    })
    expect(runOpenClaw).toHaveBeenCalledWith(
      ['agents', 'add', 'agent-evaluation-specialist', '--workspace', workspaceDir, '--non-interactive'],
      { timeoutMs: 20_000 },
    )
    expect(writeAgentToConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-evaluation-specialist',
        name: 'Agent Evaluation Specialist',
        workspace: workspaceDir,
      }),
    )
    expect(readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf-8')).toContain('Agent Rules')
    expect(readFileSync(path.join(workspaceDir, 'SOUL.md'), 'utf-8')).toContain('Review work critically')
  })

  it('skips provisioning when the OpenClaw agent id already exists', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-openclaw-agent-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    const workspaceDir = path.join(tempDir, 'existing-agent')
    mkdirSync(workspaceDir, { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({ agents: { list: [{ id: 'agent-evaluation-specialist', workspace: workspaceDir }] } }, null, 2) + '\n',
      'utf-8',
    )
    writeFileSync(path.join(workspaceDir, 'AGENT.md'), '# Existing Rules\n', 'utf-8')

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    const { ensureOpenClawAgent } = await import('@/lib/openclaw-agent-provision')
    const result = await ensureOpenClawAgent({
      agentName: 'Agent Evaluation Specialist',
      agentConfigRaw: JSON.stringify({ workspace: workspaceDir }),
      soulContent: null,
    })

    expect(result).toEqual({
      agentId: 'agent-evaluation-specialist',
      created: false,
      workspace: workspaceDir,
    })
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(writeAgentToConfig).not.toHaveBeenCalled()
    expect(readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf-8')).toContain('Existing Rules')
  })
})
