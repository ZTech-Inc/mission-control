'use client'

import { type Agent } from '@/store'

interface AgentStatusBadgeProps {
  status: Agent['status']
  variant: 'dot' | 'labeled' | 'labeled-with-queue'
  size?: 'sm' | 'md'
}

const STATUS_META: Record<Agent['status'], { dot: string; label: string; text: string }> = {
  idle: {
    dot: 'bg-green-500',
    label: 'Available',
    text: 'text-green-500',
  },
  busy: {
    dot: 'bg-yellow-500',
    label: 'Busy',
    text: 'text-yellow-500',
  },
  error: {
    dot: 'bg-red-500',
    label: 'Error',
    text: 'text-red-500',
  },
  offline: {
    dot: 'bg-gray-500',
    label: 'Offline',
    text: 'text-gray-500',
  },
}

export function AgentStatusBadge({ status, variant, size = 'sm' }: AgentStatusBadgeProps) {
  const meta = STATUS_META[status] ?? STATUS_META.offline
  const dotSize = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2'
  const dotClass = `${dotSize} rounded-full ${meta.dot} ${status === 'busy' ? 'pulse-dot' : ''}`

  if (variant === 'dot') {
    return <span aria-label={`Agent status: ${status}`} className={dotClass} />
  }

  return (
    <div className="flex items-center gap-2">
      <span aria-label={`Agent status: ${status}`} className={dotClass} />
      <div className="leading-tight">
        <div className={`text-xs font-mono ${meta.text}`}>{meta.label}</div>
        {variant === 'labeled-with-queue' && status === 'busy' ? (
          <div aria-live="polite" className="text-[10px] font-mono text-muted-foreground/50">
            Busy -- messages will queue
          </div>
        ) : null}
      </div>
    </div>
  )
}
