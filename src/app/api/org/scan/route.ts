import { NextRequest, NextResponse } from 'next/server'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { getOrgSnapshot, invalidateOrgSnapshot } from '@/lib/org-scanner'
import { orgWatcher } from '@/lib/org-watcher'
import { config } from '@/lib/config'
import { runCommand } from '@/lib/command'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'
import { getDatabase } from '@/lib/db'
import { getEffectiveEnvValue } from '@/lib/runtime-env'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function buildGitAuthEnv(token: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  }
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
    env.GIT_HTTP_EXTRAHEADER = `AUTHORIZATION: basic ${basic}`
  }
  return env
}

async function git(args: string[], cwd: string, authToken: string | null, timeoutMs = 45_000): Promise<string> {
  const result = await runCommand('git', args, {
    cwd,
    timeoutMs,
    env: buildGitAuthEnv(authToken),
  })
  return result.stdout.trim()
}

function normalizeGitHubRepo(raw: string): { ownerRepo: string; cloneUrl: string } | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  if (httpsMatch?.[1]) {
    const ownerRepo = httpsMatch[1]
    return { ownerRepo, cloneUrl: `https://github.com/${ownerRepo}.git` }
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i)
  if (sshMatch?.[1]) {
    const ownerRepo = sshMatch[1]
    return { ownerRepo, cloneUrl: `https://github.com/${ownerRepo}.git` }
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    return { ownerRepo: trimmed, cloneUrl: `https://github.com/${trimmed}.git` }
  }

  return null
}

function readOrgSyncSettings(_workspaceId: number): { repoInput: string; branch: string } {
  const db = getDatabase()
  const rows = db.prepare(
    `SELECT key, value FROM settings WHERE key IN ('org.github_repo', 'org.github_branch')`
  ).all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map((row) => [row.key, row.value]))

  const repoInput = String(map.get('org.github_repo') || 'ZTech-Inc/ZTech_Agents').trim()
  const branchRaw = String(map.get('org.github_branch') || 'main').trim()
  const branch = branchRaw || 'main'

  return { repoInput, branch }
}

async function syncOrgRepoFromGitHub(params: {
  repoPath: string
  repoInput: string
  branch: string
  authToken: string | null
}) {
  const parsedRepo = normalizeGitHubRepo(params.repoInput)
  if (!parsedRepo) {
    throw new Error('Invalid org.github_repo setting. Use owner/repo or a GitHub URL.')
  }

  const resolvedPath = path.resolve(params.repoPath)
  const branch = String(params.branch || 'main').trim() || 'main'
  const cloneUrl = parsedRepo.cloneUrl

  if (!existsSync(resolvedPath)) {
    mkdirSync(path.dirname(resolvedPath), { recursive: true })
    await git(
      ['clone', '--branch', branch, '--single-branch', cloneUrl, resolvedPath],
      path.dirname(resolvedPath),
      params.authToken,
      120_000,
    )
    const afterCommit = await git(['rev-parse', 'HEAD'], resolvedPath, params.authToken, 10_000)
    return {
      repoPath: resolvedPath,
      branch,
      beforeCommit: null as string | null,
      afterCommit,
      changed: true,
      cloned: true,
    }
  }

  const stat = statSync(resolvedPath)
  if (!stat.isDirectory()) {
    throw new Error(`AGENTS_DIR is not a directory: ${resolvedPath}`)
  }

  let isWorkTree = false
  try {
    isWorkTree = (await git(['rev-parse', '--is-inside-work-tree'], resolvedPath, params.authToken, 10_000)) === 'true'
  } catch {
    isWorkTree = false
  }

  if (!isWorkTree) {
    const entries = readdirSync(resolvedPath, { withFileTypes: true }).filter(
      (entry) => entry.name !== '.' && entry.name !== '..',
    )
    if (entries.length > 0) {
      throw new Error(`AGENTS_DIR exists but is not a git repo: ${resolvedPath}. Empty the directory or point AGENTS_DIR to a git clone.`)
    }
    await git(
      ['clone', '--branch', branch, '--single-branch', cloneUrl, resolvedPath],
      path.dirname(resolvedPath),
      params.authToken,
      120_000,
    )
    const afterCommit = await git(['rev-parse', 'HEAD'], resolvedPath, params.authToken, 10_000)
    return {
      repoPath: resolvedPath,
      branch,
      beforeCommit: null as string | null,
      afterCommit,
      changed: true,
      cloned: true,
    }
  }

  const beforeCommit = await git(['rev-parse', 'HEAD'], resolvedPath, params.authToken, 10_000)

  // Keep origin URL aligned with configured repo input.
  try {
    const currentOrigin = await git(['remote', 'get-url', 'origin'], resolvedPath, params.authToken, 10_000)
    if (!currentOrigin.includes(parsedRepo.ownerRepo)) {
      await git(['remote', 'set-url', 'origin', cloneUrl], resolvedPath, params.authToken, 10_000)
    }
  } catch {
    await git(['remote', 'add', 'origin', cloneUrl], resolvedPath, params.authToken, 10_000)
  }

  await git(['fetch', '--prune', 'origin'], resolvedPath, params.authToken, 60_000)
  await git(['pull', '--ff-only', 'origin', branch], resolvedPath, params.authToken, 60_000)

  const afterCommit = await git(['rev-parse', 'HEAD'], resolvedPath, params.authToken, 10_000)
  return {
    repoPath: resolvedPath,
    branch,
    beforeCommit,
    afterCommit,
    changed: beforeCommit !== afterCommit,
    cloned: false,
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  orgWatcher.ensureStarted(auth.user.workspace_id ?? 1)
  const force = new URL(request.url).searchParams.get('force') === 'true'
  if (force) invalidateOrgSnapshot()

  return NextResponse.json(
    getOrgSnapshot({
      force,
      workspaceId: auth.user.workspace_id ?? 1,
    })
  )
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const action = String(body?.action || 'sync-github').trim().toLowerCase()
  if (action !== 'sync-github') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const agentsDir = config.agentsDir?.trim()
  if (!agentsDir) {
    return NextResponse.json(
      { error: 'AGENTS_DIR is not configured. Set AGENTS_DIR or MISSION_CONTROL_AGENTS_DIR first.' },
      { status: 400 },
    )
  }

  try {
    const syncConfig = readOrgSyncSettings(workspaceId)
    const githubToken = (await getEffectiveEnvValue('GITHUB_TOKEN')) || null
    const sync = await syncOrgRepoFromGitHub({
      repoPath: agentsDir,
      repoInput: syncConfig.repoInput,
      branch: syncConfig.branch,
      authToken: githubToken,
    })
    invalidateOrgSnapshot(workspaceId)
    orgWatcher.ensureStarted(workspaceId)
    const snapshot = getOrgSnapshot({ force: true, workspaceId })
    eventBus.broadcast('org.updated', {
      rootPath: sync.repoPath,
      changedAt: Date.now(),
      commit: sync.afterCommit,
      changed: sync.changed,
      source: 'github-sync',
    })

    return NextResponse.json({ ok: true, action, sync, snapshot })
  } catch (error) {
    logger.error({ err: error, action, agentsDir }, 'Failed to sync org repo from GitHub')
    const message = error instanceof Error ? error.message : 'Failed to sync org repository from GitHub'
    const authHint = /auth|authentication|forbidden|permission|terminal prompts disabled/i.test(message)
      ? ' Private repo access failed. Configure GITHUB_TOKEN in Settings -> Org Sync section.'
      : ''
    return NextResponse.json(
      { error: `${message}${authHint}`.trim() },
      { status: 500 },
    )
  }
}
