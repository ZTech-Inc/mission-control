import { existsSync, FSWatcher, readdirSync, statSync, watch } from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { eventBus } from '@/lib/event-bus'
import { getOrgSnapshot, invalidateOrgSnapshot } from '@/lib/org-scanner'
import { logger } from '@/lib/logger'

class OrgWatcher {
  private watchers = new Map<string, FSWatcher>()
  private rootPath: string | null = null
  private debounceHandle: NodeJS.Timeout | null = null

  ensureStarted(workspaceId = 1): void {
    const configuredRoot = config.agentsDir?.trim()
    if (!configuredRoot) return

    const nextRoot = path.resolve(configuredRoot)
    if (this.rootPath === nextRoot && this.watchers.size > 0) return

    this.stop()

    if (!existsSync(nextRoot)) return
    try {
      if (!statSync(nextRoot).isDirectory()) return
    } catch {
      return
    }

    this.rootPath = nextRoot
    this.syncDirectoryWatchers(nextRoot)
    void getOrgSnapshot({ force: true, workspaceId })
  }

  stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close()
    }
    this.watchers.clear()
    this.rootPath = null
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle)
      this.debounceHandle = null
    }
  }

  private collectDirectories(root: string): string[] {
    const pending = [root]
    const results: string[] = []

    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) continue
      results.push(current)

      let entries
      try {
        entries = readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        pending.push(path.join(current, entry.name))
      }
    }

    return results
  }

  private syncDirectoryWatchers(root: string): void {
    const directories = new Set(this.collectDirectories(root))

    for (const directory of directories) {
      if (this.watchers.has(directory)) continue
      try {
        const watcher = watch(directory, () => this.scheduleRescan())
        this.watchers.set(directory, watcher)
      } catch (error) {
        logger.warn({ err: error, directory }, 'Failed to watch org directory')
      }
    }

    for (const [directory, watcher] of this.watchers.entries()) {
      if (directories.has(directory)) continue
      watcher.close()
      this.watchers.delete(directory)
    }
  }

  private scheduleRescan(): void {
    if (!this.rootPath) return
    if (this.debounceHandle) clearTimeout(this.debounceHandle)

    this.debounceHandle = setTimeout(() => {
      if (!this.rootPath) return
      this.syncDirectoryWatchers(this.rootPath)
      invalidateOrgSnapshot()
      eventBus.broadcast('org.updated', {
        rootPath: this.rootPath,
        changedAt: Date.now(),
      })
    }, 500)
  }
}

const globalWatcher = globalThis as typeof globalThis & { __orgWatcher?: OrgWatcher }
export const orgWatcher = globalWatcher.__orgWatcher ?? new OrgWatcher()
globalWatcher.__orgWatcher = orgWatcher
