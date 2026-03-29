'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Agent, type ChatAttachment, type ChatMessage } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { AgentStatusBadge } from '@/components/ui/agent-status-badge'
import { ChatInput } from './chat-input'
import { MessageBubble } from './message-bubble'

interface EmbeddedChatProps {
  conversationId: string
  targetAgentName: string
  targetAgentStatus: Agent['status']
  entityLabel: string
  entityColor?: string
}

function getSystemMessage(name: string, status: Agent['status']): string | null {
  switch (status) {
    case 'busy':
      return `${name} is busy. Your message is queued and will be delivered.`
    case 'offline':
      return `${name} is offline. Your message will be delivered when available.`
    case 'error':
      return `${name} is in an error state. Your message was sent but response may be delayed.`
    default:
      return null
  }
}

export function EmbeddedChat({
  conversationId,
  targetAgentName,
  targetAgentStatus,
  entityLabel,
  entityColor,
}: EmbeddedChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const pendingIdRef = useRef(-1)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/messages?conversation_id=${encodeURIComponent(conversationId)}&limit=100`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.messages)) {
        setMessages(data.messages)
      }
    } catch {
      // Silent failure to preserve current UI state.
    }
  }, [conversationId])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  useSmartPoll(loadMessages, 15000, {
    enabled: true,
    pauseWhenSseConnected: true,
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = useCallback(
    async (content: string, attachments?: ChatAttachment[]) => {
      pendingIdRef.current -= 1
      const tempId = pendingIdRef.current

      const optimistic: ChatMessage = {
        id: tempId,
        conversation_id: conversationId,
        from_agent: 'human',
        to_agent: targetAgentName,
        content,
        message_type: 'text',
        attachments,
        created_at: Math.floor(Date.now() / 1000),
        pendingStatus: 'sending',
      }

      setMessages((prev) => [...prev, optimistic])
      setIsGenerating(true)

      try {
        const res = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'human',
            to: targetAgentName,
            content,
            conversation_id: conversationId,
            message_type: 'text',
            attachments,
            forward: true,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          if (data.message) {
            setMessages((prev) => prev.map((msg) => (msg.id === tempId ? data.message : msg)))
          } else {
            setMessages((prev) => prev.map((msg) => (msg.id === tempId ? { ...msg, pendingStatus: 'sent' } : msg)))
          }

          if (targetAgentStatus !== 'idle') {
            const sysMsg = getSystemMessage(targetAgentName, targetAgentStatus)
            if (sysMsg) {
              setMessages((prev) => [
                ...prev,
                {
                  id: Date.now(),
                  conversation_id: conversationId,
                  from_agent: 'system',
                  to_agent: null,
                  content: sysMsg,
                  message_type: 'status',
                  created_at: Math.floor(Date.now() / 1000),
                },
              ])
            }
          }
        } else {
          setMessages((prev) => prev.map((msg) => (msg.id === tempId ? { ...msg, pendingStatus: 'failed' } : msg)))
        }
      } catch {
        setMessages((prev) => prev.map((msg) => (msg.id === tempId ? { ...msg, pendingStatus: 'failed' } : msg)))
      } finally {
        setIsGenerating(false)
      }
    },
    [conversationId, targetAgentName, targetAgentStatus]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 bg-[hsl(var(--surface-1))] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {entityColor ? (
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: entityColor }} />
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold font-mono text-foreground">Chat with {entityLabel}</div>
            <div className="truncate text-xs font-mono text-muted-foreground">Lead: {targetAgentName}</div>
          </div>
        </div>
        <AgentStatusBadge status={targetAgentStatus} variant="labeled-with-queue" />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground/30">
            <span className="mb-3 text-4xl font-mono">/</span>
            <span className="text-sm font-mono">Start a conversation with {entityLabel}</span>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.message_type === 'status') {
              return (
                <div key={msg.id} role="status" className="py-1 text-center text-xs font-mono text-muted-foreground/50">
                  {msg.content}
                </div>
              )
            }

            return (
              <div key={msg.id} className={msg.pendingStatus === 'sending' ? 'opacity-60' : ''}>
                <MessageBubble message={msg} isHuman={msg.from_agent === 'human'} isGrouped={false} />
                {msg.pendingStatus === 'failed' ? (
                  <div className="mt-1 pl-9 text-[10px] font-mono text-red-400">Failed to send.</div>
                ) : null}
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex-shrink-0 border-t border-border/50">
        <ChatInput
          onSend={handleSend}
          disabled={false}
          isGenerating={isGenerating}
          placeholder={`Message ${entityLabel}...`}
        />
      </div>
    </div>
  )
}
