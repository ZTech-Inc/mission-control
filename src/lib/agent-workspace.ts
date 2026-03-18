import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { config } from '@/lib/config'
import { resolveWithin } from '@/lib/paths'

function resolvePath(candidate: string): string {
  if (isAbsolute(candidate)) return resolve(candidate)
  if (!config.openclawStateDir) throw new Error('OPENCLAW_STATE_DIR not configured')
  return resolveWithin(config.openclawStateDir, candidate)
}

function isDirectory(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

export function getAgentWorkspaceCandidates(agentConfig: any, agentName: string, workspacePath?: string | null): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value?: string | null) => {
    if (!value) return
    try {
      const resolved = isAbsolute(value) ? resolve(value) : resolvePath(value)
      if (seen.has(resolved)) return
      seen.add(resolved)
      out.push(resolved)
    } catch {
      // ignore invalid/out-of-bounds candidates
    }
  }

  // workspacePath from DB column — highest priority
  // Only add it if it's a directory; flat .md files are handled separately in the API route
  if (workspacePath) {
    const absWp = isAbsolute(workspacePath) ? resolve(workspacePath) : null
    if (absWp && isDirectory(absWp)) {
      push(absWp)
    }
  }

  const rawWorkspace = typeof agentConfig?.workspace === 'string' ? agentConfig.workspace.trim() : ''
  const openclawIdRaw =
    typeof agentConfig?.openclawId === 'string' && agentConfig.openclawId.trim()
      ? agentConfig.openclawId.trim()
      : agentName
  const openclawId = openclawIdRaw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

  push(rawWorkspace || null)
  push(`workspace-${openclawId}`)
  push(`agents/${openclawId}`)

  // Only fall back to the openclaw workspace dir when there is no workspace_path at all
  // (i.e., openclaw gateway-synced agents without an explicit path).
  // Agents with a workspace_path (even a flat .md file) must NOT fall through here.
  if (!workspacePath && config.openclawStateDir) {
    push(`${config.openclawStateDir}/workspace`)
  }

  return out.filter((value) => existsSync(value) && isDirectory(value))
}

export type AgentType = 'openclaw' | 'claude-code' | 'codex' | 'generic'

export function getAgentType(agent: { source?: string | null; workspace_path?: string | null }): AgentType {
  if (agent.source !== 'local') return 'openclaw'
  const wp = agent.workspace_path || ''
  if (wp.includes('/.claude/')) return 'claude-code'
  if (wp.includes('/.codex/')) return 'codex'
  return 'generic'
}

export function readAgentWorkspaceFile(
  workspaceCandidates: string[],
  names: string[]
): { content: string; path: string; exists: true } | { content: ''; path: null; exists: false } {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  for (const workspace of workspaceCandidates) {
    for (const name of names) {
      try {
        const fullPath = resolveWithin(workspace, name)
        if (existsSync(fullPath)) {
          return { content: readFileSync(fullPath, 'utf-8'), path: fullPath, exists: true }
        }
      } catch {
        // ignore and continue
      }
    }
  }
  return { content: '', path: null, exists: false }
}
