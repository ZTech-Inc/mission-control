'use client'

import type { ReactNode } from 'react'

export interface SkillSummary {
  id: string
  name: string
  source: string
  path: string
  description?: string
  registry_slug?: string | null
  security_status?: string | null
}

export interface SkillSecurityIssue {
  severity: string
  rule: string
  description: string
  line?: number
}

export interface SkillContentResponse {
  source: string
  name: string
  skillPath: string
  skillDocPath: string
  content: string
  security?: { status: string; issues: SkillSecurityIssue[] }
}

const SOURCE_LABELS: Record<string, string> = {
  'user-agents': '~/.agents/skills (global)',
  'user-codex': '~/.codex/skills (global)',
  'project-agents': '.agents/skills (project)',
  'project-codex': '.codex/skills (project)',
  'openclaw': '~/.openclaw/skills (gateway)',
  'workspace': '~/.openclaw/workspace/skills',
}

function formatSourceTitle(source: string): string {
  return source
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getSkillSourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source]
  if (source.startsWith('org-agent:')) {
    return `${formatSourceTitle(source.replace('org-agent:', ''))} skills`
  }
  if (source.startsWith('project-')) {
    return 'project skills'
  }
  if (source.startsWith('workspace-')) {
    const agentName = source.replace('workspace-', '')
    return `${agentName} workspace`
  }
  return source
}

interface SkillContentViewerProps {
  skill: Pick<SkillSummary, 'name' | 'source' | 'path'> | null
  content: SkillContentResponse | null
  loading: boolean
  error: string | null
  readOnly?: boolean
  value?: string
  onValueChange?: (value: string) => void
  emptyMessage?: string
  actions?: ReactNode
  footer?: ReactNode
}

export function SkillContentViewer({
  skill,
  content,
  loading,
  error,
  readOnly = true,
  value,
  onValueChange,
  emptyMessage = 'No skill selected.',
  actions,
  footer,
}: SkillContentViewerProps) {
  const source = content?.source || skill?.source || ''
  const displayValue = value ?? content?.content ?? ''

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border">
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{skill?.name || 'Skill viewer'}</h3>
            {source ? <p className="text-2xs text-muted-foreground">{getSkillSourceLabel(source)}</p> : null}
            {skill?.path || content?.skillPath ? (
              <p className="truncate text-2xs text-muted-foreground">{skill?.path || content?.skillPath}</p>
            ) : null}
            {source ? <p className="mt-1 text-2xs text-muted-foreground">{source}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        {footer ? <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{footer}</div> : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading skill content...</div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : content ? (
          <>
            {content.security && content.security.issues.length > 0 && (
              <div className={`mx-4 mt-3 rounded-lg border p-3 text-xs ${
                content.security.status === 'rejected'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : content.security.status === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-slate-500/30 bg-slate-500/10 text-slate-300'
              }`}>
                <div className="mb-1 font-medium">Security: {content.security.status}</div>
                {content.security.issues.map((issue, index) => (
                  <div key={`${issue.rule}-${index}`} className="mt-1 flex items-start gap-1.5">
                    <span className={`mt-0.5 font-mono text-2xs ${
                      issue.severity === 'critical'
                        ? 'text-rose-400'
                        : issue.severity === 'warning'
                          ? 'text-amber-400'
                          : 'text-slate-400'
                    }`}>
                      [{issue.severity}]
                    </span>
                    <span>{issue.description}{issue.line ? ` (line ${issue.line})` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            {readOnly ? (
              <pre className="min-h-[70vh] whitespace-pre-wrap break-words bg-card p-4 font-mono text-xs leading-5 text-muted-foreground">
                {displayValue}
              </pre>
            ) : (
              <textarea
                value={displayValue}
                onChange={(event) => onValueChange?.(event.target.value)}
                readOnly={false}
                className="min-h-[70vh] w-full rounded-none border-0 bg-card p-4 font-mono text-xs leading-5 text-muted-foreground focus:outline-none"
              />
            )}
          </>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">{emptyMessage}</div>
        )}
      </div>
    </div>
  )
}
