import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { writeAgentToConfig } from '@/lib/agent-sync'
import { getAgentWorkspaceCandidates, readAgentWorkspaceFile } from '@/lib/agent-workspace'
import { runOpenClaw } from '@/lib/command'
import { config } from '@/lib/config'
import { parseJsonRelaxed } from '@/lib/json-relaxed'
import { logger } from '@/lib/logger'
import { resolveWithin } from '@/lib/paths'

function parseAgentConfig(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function normalizeOpenClawAgentId(value: string | null | undefined): string {
  const raw = String(value || '').trim().toLowerCase()
  const normalized = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'agent'
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function resolveWorkspacePath(candidate: string): string {
  if (path.isAbsolute(candidate)) return path.resolve(candidate)
  if (!config.openclawStateDir) throw new Error('OPENCLAW_STATE_DIR not configured')
  return resolveWithin(config.openclawStateDir, candidate)
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

async function readConfiguredAgentIds(): Promise<Set<string>> {
  const configPath = config.openclawConfigPath
  if (!configPath || !existsSync(configPath)) return new Set()
  const raw = await readFile(configPath, 'utf-8')
  const parsed = parseJsonRelaxed<any>(raw)
  const list = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : []
  return new Set(
    list
      .map((entry: any) => normalizeOpenClawAgentId(entry?.id))
      .filter(Boolean),
  )
}

function resolveProvisionWorkspace(params: {
  agentId: string
  agentName: string
  agentConfigRaw?: string | null
  workspacePath?: string | null
}): { workspace: string | null; sourceCandidates: string[]; parsedConfig: Record<string, any> } {
  const parsedConfig = parseAgentConfig(params.agentConfigRaw)
  const sourceCandidates = getAgentWorkspaceCandidates(
    parsedConfig,
    params.agentName,
    params.workspacePath,
  )

  if (sourceCandidates.length > 0) {
    return { workspace: sourceCandidates[0], sourceCandidates, parsedConfig }
  }

  const configuredWorkspace =
    typeof parsedConfig.workspace === 'string' && parsedConfig.workspace.trim()
      ? parsedConfig.workspace.trim()
      : null

  if (configuredWorkspace) {
    return {
      workspace: resolveWorkspacePath(configuredWorkspace),
      sourceCandidates,
      parsedConfig,
    }
  }

  if (params.workspacePath && isDirectory(params.workspacePath)) {
    return {
      workspace: path.resolve(params.workspacePath),
      sourceCandidates: [path.resolve(params.workspacePath)],
      parsedConfig,
    }
  }

  if (!config.openclawStateDir) {
    return { workspace: null, sourceCandidates, parsedConfig }
  }

  return {
    workspace: path.join(config.openclawStateDir, 'workspaces', params.agentId),
    sourceCandidates,
    parsedConfig,
  }
}

async function syncWorkspacePromptFiles(params: {
  workspace: string
  sourceCandidates: string[]
  soulContent?: string | null
}) {
  await mkdir(params.workspace, { recursive: true })

  const explicitSoul = String(params.soulContent || '').trim()
  const sourcedSoul = readAgentWorkspaceFile(params.sourceCandidates, ['SOUL.md', 'soul.md'])
  const soulToWrite = explicitSoul || (sourcedSoul.exists ? sourcedSoul.content.trim() : '')
  if (soulToWrite) {
    await writeFile(
      path.join(params.workspace, 'SOUL.md'),
      ensureTrailingNewline(soulToWrite),
      'utf-8',
    )
  }

  const sourcedAgents = readAgentWorkspaceFile(params.sourceCandidates, ['AGENTS.md', 'agents.md'])
  const sourcedAgent = readAgentWorkspaceFile(params.sourceCandidates, ['AGENT.md', 'agent.md'])
  const agentsToWrite =
    (sourcedAgents.exists ? sourcedAgents.content.trim() : '') ||
    (sourcedAgent.exists ? sourcedAgent.content.trim() : '')
  if (agentsToWrite) {
    await writeFile(
      path.join(params.workspace, 'AGENTS.md'),
      ensureTrailingNewline(agentsToWrite),
      'utf-8',
    )
  }
}

function buildWriteBackPayload(params: {
  agentId: string
  agentName: string
  workspace: string
  parsedConfig: Record<string, any>
}): Record<string, any> {
  const payload: Record<string, any> = {
    id: params.agentId,
    name: params.agentName,
    workspace: params.workspace,
  }

  for (const key of ['agentDir', 'model', 'identity', 'sandbox', 'tools', 'subagents', 'memorySearch']) {
    if (params.parsedConfig[key] !== undefined) {
      payload[key] = params.parsedConfig[key]
    }
  }

  return payload
}

export async function ensureOpenClawAgent(params: {
  agentId?: string | null
  agentName: string
  agentConfigRaw?: string | null
  workspacePath?: string | null
  soulContent?: string | null
}): Promise<{ agentId: string; created: boolean; workspace: string | null }> {
  const parsedConfig = parseAgentConfig(params.agentConfigRaw)
  const desiredAgentId = normalizeOpenClawAgentId(
    params.agentId || parsedConfig.openclawId || params.agentName,
  )
  const { workspace, sourceCandidates, parsedConfig: resolvedConfig } = resolveProvisionWorkspace({
    agentId: desiredAgentId,
    agentName: params.agentName,
    agentConfigRaw: params.agentConfigRaw,
    workspacePath: params.workspacePath,
  })

  const configuredIds = await readConfiguredAgentIds()
  if (configuredIds.has(desiredAgentId)) {
    if (workspace) {
      await syncWorkspacePromptFiles({
        workspace,
        sourceCandidates: sourceCandidates.length > 0 ? sourceCandidates : [workspace],
        soulContent: params.soulContent,
      })
    }
    return { agentId: desiredAgentId, created: false, workspace }
  }

  if (!workspace) {
    logger.warn(
      { agentId: desiredAgentId, agentName: params.agentName },
      'OpenClaw agent is missing from config and no workspace is available for provisioning; using stored id as-is',
    )
    return { agentId: desiredAgentId, created: false, workspace: null }
  }

  logger.info({ agentId: desiredAgentId, workspace }, 'Provisioning missing OpenClaw agent')
  await runOpenClaw(
    ['agents', 'add', desiredAgentId, '--workspace', workspace, '--non-interactive'],
    { timeoutMs: 20_000 },
  )

  try {
    await writeAgentToConfig(
      buildWriteBackPayload({
        agentId: desiredAgentId,
        agentName: params.agentName,
        workspace,
        parsedConfig: resolvedConfig,
      }),
    )
  } catch (error) {
    logger.warn(
      { err: error, agentId: desiredAgentId },
      'Failed to write OpenClaw agent config payload after provisioning',
    )
  }

  await syncWorkspacePromptFiles({
    workspace,
    sourceCandidates: sourceCandidates.length > 0 ? sourceCandidates : [workspace],
    soulContent: params.soulContent,
  })

  return { agentId: desiredAgentId, created: true, workspace }
}
