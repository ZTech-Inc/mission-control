# OpenClaw Chat UI ↔ Agent Integration Guide

This document explains how OpenClaw's frontend connects its chat UI to agents, and provides a concrete roadmap for implementing the same streaming chat flow in Mission Control.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [OpenClaw Protocol Reference](#2-openclaw-protocol-reference)
3. [Mission Control's Current State](#3-mission-controls-current-state)
4. [Gaps & What Needs to Be Built](#4-gaps--what-needs-to-be-built)
5. [Step-by-Step Implementation Plan](#5-step-by-step-implementation-plan)
6. [Key Files Reference](#6-key-files-reference)

---

## 1. Architecture Overview

### OpenClaw's Model

```
Browser
  │
  ├── WebSocket (ws://localhost:18789)
  │     ├── SEND  req  { type:"req",  id, method, params }
  │     ├── RECV  res  { type:"res",  id, ok, payload }
  │     └── RECV  event{ type:"event", event, payload, seq }
  │
  └── Key flows:
        chat.send ──► gateway starts running agent ──► streams "chat" events back
        agents.list ──► returns all registered agents
        chat.history ──► returns past messages for a session
        chat.abort ──► cancels a running chat
```

Mission Control uses the **same gateway** and the **same WebSocket connection** (`src/lib/websocket.ts`). It already handles several gateway events (`chat.message`, `tool.stream`, `exec.approval`, etc.) but does **not** yet use the primary `chat.send` / `chat` streaming protocol for interactive chat.

---

## 2. OpenClaw Protocol Reference

### 2.1 Wire Frame Format

All WebSocket messages are JSON with one of three shapes:

```typescript
// Client → Gateway: initiate an RPC call
interface RequestFrame {
  type: 'req'
  id: string        // UUID for correlation
  method: string    // e.g. "chat.send"
  params: unknown
}

// Gateway → Client: response to an RPC call
interface ResponseFrame {
  type: 'res'
  id: string        // matches RequestFrame.id
  ok: boolean
  payload?: unknown
  error?: {
    code: string    // e.g. "INVALID_REQUEST", "FORBIDDEN"
    message: string
    details?: unknown
    retryable?: boolean
    retryAfterMs?: number
  }
}

// Gateway → Client: unsolicited server event
interface EventFrame {
  type: 'event'
  event: string     // e.g. "chat", "agent", "tick", "health"
  payload?: unknown
  seq?: number      // monotonic, detect gaps
  stateVersion?: { presence: number; health: number }
}
```

### 2.2 Session Keys

Session keys route messages to the right agent session. Format:

```
[agent:]<agentId>:<sessionScope>[:<peer1>[:<peer2>]]
```

Examples:
- `main` — default agent, main session
- `agent:my-agent:main` — named agent, main session
- `slack:@username:dm` — Slack DM session (channel integration)
- `cron` — scheduled/cron session

### 2.3 Chat RPC Methods

#### `chat.send`

Sends a message to the agent. The RPC response is empty — the actual streaming reply arrives as a series of `chat` events.

```typescript
// Params
interface ChatSendParams {
  sessionKey: string        // e.g. "main" or "agent:my-agent:main"
  message: {
    role: 'user'
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >
  }
  idempotencyKey: string    // UUID to prevent duplicate sends
  attachments?: unknown[]
  thinking?: boolean
  deliver?: string          // Optional delivery channel
}

// Response: empty (streaming comes via events)
```

#### `chat.history`

Loads previous messages for a session.

```typescript
// Params
interface ChatHistoryParams {
  sessionKey: string
  limit?: number
}

// Response
interface ChatHistoryResponse {
  messages: ChatMessage[]
  thinkingLevel?: number
}
```

#### `chat.abort`

Cancels the current streaming run.

```typescript
interface ChatAbortParams {
  sessionKey: string
  runId?: string   // Optional — aborts current run if omitted
}
```

#### `agents.list`

Discovers all registered agents.

```typescript
// Response
interface AgentsListResponse {
  agents: Array<{
    id: string
    name?: string
    emoji?: string
    avatar?: string
    sessionKey?: string
  }>
  defaultId?: string
  mainSessionKey?: string
}
```

### 2.4 Chat Streaming Events

After `chat.send`, the gateway pushes `chat` events with `frame.event === "chat"`:

```typescript
interface ChatEventPayload {
  runId: string
  sessionKey: string
  seq: number         // Monotonic, starts at 0 for each run

  state: 'delta' | 'final' | 'aborted' | 'error'

  // state === 'delta'
  message?: { text: string }   // Incremental text chunk

  // state === 'final'
  message?: {
    role: 'assistant'
    content: Array<{ type: 'text'; text: string }>
    timestamp?: number
  }
  usage?: { input_tokens?: number; output_tokens?: number }
  stopReason?: string

  // state === 'aborted'
  message?: { role: 'assistant'; content: Array<{ type: 'text'; text?: string }> }

  // state === 'error'
  errorMessage?: string
}
```

**Streaming state machine:**

```
chat.send ──► [delta, delta, delta, ...] ──► final
                                         └──► aborted   (user called chat.abort)
                                         └──► error     (agent or gateway error)
```

### 2.5 Agent Events (Tool Calls)

Tool call progress arrives as `agent` events (`frame.event === "agent"`):

```typescript
interface AgentEventPayload {
  runId: string
  seq: number
  stream: string        // "tool_call" | "tool_result" | "task_completion"
  ts: number
  sessionKey?: string
  data: {
    // For tool_call:
    toolCallId?: string
    name?: string
    args?: unknown

    // For tool_result:
    toolCallId?: string
    output?: string
    status?: 'success' | 'error'
    durationMs?: number

    // For task_completion:
    type?: 'task_completion'
    source?: 'subagent' | 'cron'
    status?: 'ok' | 'timeout' | 'error' | 'unknown'
    result?: string
  }
}
```

---

## 3. Mission Control's Current State

### What's Already Working

| Feature | File | Status |
|---------|------|--------|
| WebSocket connection + reconnect | `src/lib/websocket.ts` | ✅ Working |
| Gateway auth (device identity + token) | `src/lib/device-identity.ts`, `src/lib/auth.ts` | ✅ Working |
| `chat.message` event handler | `src/lib/websocket.ts:516` | ✅ Working |
| `tool.stream` event handler | `src/lib/websocket.ts:558` | ✅ Working |
| `agent.status` event handler | `src/lib/websocket.ts:546` | ✅ Working |
| Chat message store (Zustand) | `src/store/index.ts` | ✅ Working |
| Chat UI components | `src/components/chat/` | ✅ Working |
| `sendMessage()` helper | `src/lib/websocket.ts:856` | ✅ Working |

### What's Missing

| Feature | Gap |
|---------|-----|
| `chat.send` RPC over WebSocket | `EmbeddedChat` uses HTTP POST instead |
| Streaming text (`delta` events) | No handler for `frame.event === "chat"` |
| In-progress streaming state | No `chatStream` / `isStreaming` concept |
| `chat.history` RPC | Uses HTTP polling (`/api/chat/messages`) |
| `chat.abort` RPC | No abort button / API |
| `agents.list` RPC | Agents loaded via HTTP, not gateway RPC |
| Run ID tracking | No `runId` tracked per stream |
| Sequence gap detection | Events processed without seq ordering |

### Current Chat Send Flow (HTTP-based)

```
User types → handleSend() → POST /api/chat/messages
                              ↓
                           Mission Control HTTP handler
                              ↓ (forwards to gateway somehow)
                           Polling: GET /api/chat/messages every 15s
```

### Target Chat Send Flow (WebSocket streaming)

```
User types → sendChatMessage() → WS req { method: "chat.send", params }
                                    ↓
                                 frame.event === "chat", state === "delta"
                                    ↓ (accumulate in stream buffer)
                                 frame.event === "chat", state === "final"
                                    ↓ (commit to message history)
                                 isStreaming = false
```

---

## 4. Gaps & What Needs to Be Built

### 4.1 WebSocket RPC Helper

`sendMessage()` exists but there's no request-response helper that correlates by `id`. You need:

```typescript
function sendRequest(method: string, params: unknown): Promise<unknown>
```

This sends `{ type: "req", id: uuid(), method, params }` and resolves/rejects when the matching `{ type: "res", id }` arrives.

### 4.2 `chat` Event Handler in `websocket.ts`

The WebSocket handler in `src/lib/websocket.ts` needs a new branch for `frame.event === "chat"` that updates streaming state in the Zustand store.

### 4.3 Streaming State in Zustand Store

Add to the store:

```typescript
interface ChatStreamState {
  activeRunId: string | null
  activeSessionKey: string | null
  streamingText: string           // Accumulated delta text
  isStreaming: boolean
  streamError: string | null
  lastSeq: number
}
```

### 4.4 `useChatStream` Hook

A hook that wraps the send/abort flow and exposes streaming state to components:

```typescript
function useChatStream(sessionKey: string): {
  send: (text: string, attachments?: ChatAttachment[]) => Promise<void>
  abort: () => void
  isStreaming: boolean
  streamingText: string
  error: string | null
}
```

### 4.5 Streaming Message Bubble

`MessageBubble` needs to render an in-progress message with a cursor while `isStreaming && activeSessionKey === sessionKey`.

---

## 5. Step-by-Step Implementation Plan

### Step 1: Add a Request-Response Dispatcher to `useWebSocket`

**File:** `src/lib/websocket.ts`

Add a pending-requests map and a `sendRequest` function:

```typescript
// At module scope (alongside wsRef, etc.)
const pendingRequests = new Map<string, {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
}>()

// Inside useWebSocket, add to the message handler before the existing event dispatch:
if (frame.type === 'res') {
  const pending = pendingRequests.get(frame.id!)
  if (pending) {
    pendingRequests.delete(frame.id!)
    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      pending.reject(new Error(frame.error?.message ?? 'Gateway error'))
    }
  }
  return
}
```

Add the `sendRequest` callback to the hook return value:

```typescript
const sendRequest = useCallback(<T = unknown>(method: string, params: unknown): Promise<T> => {
  return new Promise((resolve, reject) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !handshakeCompleteRef.current) {
      reject(new Error('WebSocket not connected'))
      return
    }
    const id = crypto.randomUUID()
    pendingRequests.set(id, {
      resolve: (payload) => resolve(payload as T),
      reject,
    })
    wsRef.current.send(JSON.stringify({ type: 'req', id, method, params }))
  })
}, [])

return {
  ...existingReturns,
  sendRequest,
}
```

### Step 2: Add Streaming State to the Zustand Store

**File:** `src/store/index.ts`

Add these fields and actions:

```typescript
// State
chatStream: {
  runId: string | null
  sessionKey: string | null
  text: string
  isActive: boolean
  error: string | null
  seq: number
}

// Actions
setChatStreamDelta: (runId: string, sessionKey: string, textChunk: string, seq: number) => void
setChatStreamFinal: (message: ChatMessage) => void
setChatStreamAborted: (partialText?: string) => void
setChatStreamError: (error: string) => void
clearChatStream: () => void
```

Implementation:

```typescript
chatStream: { runId: null, sessionKey: null, text: '', isActive: false, error: null, seq: -1 },

setChatStreamDelta: (runId, sessionKey, textChunk, seq) =>
  set((state) => ({
    chatStream: {
      ...state.chatStream,
      runId,
      sessionKey,
      text: state.chatStream.runId === runId
        ? state.chatStream.text + textChunk
        : textChunk,
      isActive: true,
      seq,
    },
  })),

setChatStreamFinal: (message) =>
  set((state) => ({
    chatMessages: [...state.chatMessages, message],
    chatStream: { runId: null, sessionKey: null, text: '', isActive: false, error: null, seq: -1 },
  })),

setChatStreamError: (error) =>
  set((state) => ({
    chatStream: { ...state.chatStream, isActive: false, error },
  })),

clearChatStream: () =>
  set({ chatStream: { runId: null, sessionKey: null, text: '', isActive: false, error: null, seq: -1 } }),
```

### Step 3: Handle `chat` Events in `websocket.ts`

**File:** `src/lib/websocket.ts`

Inside the `frame.event` dispatch block, add a handler for the streaming `chat` event:

```typescript
} else if (frame.event === 'chat') {
  const p = frame.payload as {
    runId: string
    sessionKey: string
    seq: number
    state: 'delta' | 'final' | 'aborted' | 'error'
    message?: any
    errorMessage?: string
    usage?: { input_tokens?: number; output_tokens?: number }
    stopReason?: string
  }

  if (!p) return

  if (p.state === 'delta') {
    const textChunk = p.message?.text ?? ''
    setChatStreamDelta(p.runId, p.sessionKey, textChunk, p.seq)

  } else if (p.state === 'final') {
    const finalMsg: ChatMessage = {
      id: Date.now(),
      conversation_id: p.sessionKey,
      from_agent: 'assistant',
      to_agent: null,
      content: p.message?.content?.[0]?.text ?? '',
      message_type: 'text',
      metadata: {
        usage: p.usage,
        stopReason: p.stopReason,
        runId: p.runId,
      },
      created_at: p.message?.timestamp ?? Math.floor(Date.now() / 1000),
    }
    setChatStreamFinal(finalMsg)

  } else if (p.state === 'aborted') {
    const partialText = p.message?.content?.[0]?.text
    if (partialText) {
      setChatStreamFinal({
        id: Date.now(),
        conversation_id: p.sessionKey,
        from_agent: 'assistant',
        to_agent: null,
        content: partialText,
        message_type: 'text',
        metadata: { aborted: true },
        created_at: Math.floor(Date.now() / 1000),
      })
    } else {
      clearChatStream()
    }

  } else if (p.state === 'error') {
    setChatStreamError(p.errorMessage ?? 'Agent error')
  }
```

Also pull `setChatStreamDelta`, `setChatStreamFinal`, `setChatStreamError`, `clearChatStream` from the Zustand store at the top of the hook.

### Step 4: Create the `useChatStream` Hook

**New file:** `src/lib/use-chat-stream.ts`

```typescript
'use client'

import { useCallback } from 'react'
import { useWebSocket } from '@/lib/websocket'
import { useMissionControl } from '@/store'

export function useChatStream(sessionKey: string) {
  const { sendRequest } = useWebSocket()
  const chatStream = useMissionControl((s) => s.chatStream)
  const clearChatStream = useMissionControl((s) => s.clearChatStream)

  const isStreaming = chatStream.isActive && chatStream.sessionKey === sessionKey
  const streamingText = isStreaming ? chatStream.text : ''
  const error = chatStream.sessionKey === sessionKey ? chatStream.error : null

  const send = useCallback(
    async (text: string, attachments?: unknown[]) => {
      clearChatStream()
      await sendRequest('chat.send', {
        sessionKey,
        message: {
          role: 'user',
          content: [{ type: 'text', text }],
        },
        idempotencyKey: crypto.randomUUID(),
        ...(attachments?.length ? { attachments } : {}),
      })
      // Response is empty — streaming arrives via 'chat' events
    },
    [sessionKey, sendRequest, clearChatStream],
  )

  const abort = useCallback(() => {
    sendRequest('chat.abort', { sessionKey }).catch(() => {})
  }, [sessionKey, sendRequest])

  const loadHistory = useCallback(
    async (limit = 50) => {
      const res = await sendRequest<{ messages: unknown[] }>('chat.history', {
        sessionKey,
        limit,
      })
      return res?.messages ?? []
    },
    [sessionKey, sendRequest],
  )

  return { send, abort, loadHistory, isStreaming, streamingText, error }
}
```

### Step 5: Update `EmbeddedChat` to Use WebSocket Streaming

**File:** `src/components/chat/embedded-chat.tsx`

Replace HTTP polling with the `useChatStream` hook:

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { useChatStream } from '@/lib/use-chat-stream'
import { useMissionControl } from '@/store'
import { ChatInput } from './chat-input'
import { MessageBubble } from './message-bubble'
import { StreamingBubble } from './streaming-bubble'   // new component — see Step 6

interface EmbeddedChatProps {
  sessionKey: string    // e.g. "agent:my-agent:main"
  // ... rest of existing props
}

export function EmbeddedChat({ sessionKey, ...props }: EmbeddedChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { send, abort, loadHistory, isStreaming, streamingText, error } =
    useChatStream(sessionKey)

  const messages = useMissionControl((s) =>
    s.chatMessages.filter((m) => m.conversation_id === sessionKey)
  )

  // Load history on mount
  useEffect(() => {
    loadHistory().catch(console.error)
  }, [loadHistory])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText])

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* In-progress streaming message */}
        {isStreaming && (
          <StreamingBubble text={streamingText} onAbort={abort} />
        )}

        {error && (
          <div className="text-red-500 text-sm px-3 py-2 bg-red-50 rounded-lg">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={send}
        disabled={isStreaming}
        placeholder={isStreaming ? 'Generating...' : 'Message agent...'}
      />
    </div>
  )
}
```

### Step 6: Create `StreamingBubble` Component

**New file:** `src/components/chat/streaming-bubble.tsx`

```typescript
'use client'

import { Square } from 'lucide-react'

interface StreamingBubbleProps {
  text: string
  onAbort: () => void
}

export function StreamingBubble({ text, onAbort }: StreamingBubbleProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-muted text-sm whitespace-pre-wrap">
        {text}
        <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
      </div>
      <button
        onClick={onAbort}
        className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
      >
        <Square className="w-3 h-3 fill-current" />
        Stop generating
      </button>
    </div>
  )
}
```

### Step 7: Load History via `chat.history` RPC

The `loadHistory` function in `useChatStream` already calls `chat.history`. After calling it, save the returned messages to the Zustand store:

```typescript
// In EmbeddedChat, after mounting:
useEffect(() => {
  loadHistory().then((msgs) => {
    // Map openclaw message format to your ChatMessage type and seed the store
    msgs.forEach((m: any) => {
      addChatMessage({
        id: m.id ?? Date.now(),
        conversation_id: sessionKey,
        from_agent: m.role === 'user' ? 'human' : 'assistant',
        to_agent: m.role === 'user' ? targetAgentName : null,
        content: m.content?.[0]?.text ?? '',
        message_type: 'text',
        metadata: m.metadata,
        created_at: m.timestamp ?? Math.floor(Date.now() / 1000),
      })
    })
  })
}, [loadHistory])
```

---

## 6. Key Files Reference

### OpenClaw Source (reference only — do not modify)

| File | Purpose |
|------|---------|
| `ui/src/ui/gateway.ts` | Browser WebSocket client, `request()` method, device auth |
| `ui/src/ui/controllers/chat.ts` | `ChatState`, `handleChatEvent()` — streaming state machine |
| `ui/src/ui/app-chat.ts` | `ChatHost` — queue management, optimistic messages |
| `ui/src/ui/app-tool-stream.ts` | Tool call rendering from `agent` events |
| `src/gateway/server-methods/chat.ts` | Gateway `chat.send` / `chat.history` / `chat.abort` handlers |
| `src/gateway/protocol/schema/logs-chat.ts` | `ChatEventSchema` — canonical event shape |
| `src/gateway/auth.ts` | Auth modes: none / token / password / trusted proxy |

### Mission Control Files to Modify

| File | Change |
|------|--------|
| `src/lib/websocket.ts` | Add `pendingRequests` map, `sendRequest()`, `chat` event handler |
| `src/store/index.ts` | Add `chatStream` state + actions |
| `src/components/chat/embedded-chat.tsx` | Replace HTTP polling with `useChatStream` |

### Mission Control Files to Create

| File | Purpose |
|------|---------|
| `src/lib/use-chat-stream.ts` | `useChatStream` hook wrapping `chat.send` / `chat.abort` / `chat.history` |
| `src/components/chat/streaming-bubble.tsx` | In-progress message with cursor + stop button |

---

## Appendix: Session Key Conventions

When calling `chat.send` from Mission Control, use these session key formats depending on context:

| Context | Session Key |
|---------|-------------|
| Default agent, main chat | `"main"` |
| Specific agent | `"agent:<agentId>:main"` |
| Agent per entity (e.g. issue) | `"agent:<agentId>:entity-<entityId>"` |
| Existing conversation ID | Use the `conversation_id` from the message store, if it matches a gateway session key |

If the conversation IDs stored in Mission Control's DB don't match gateway session keys, you'll need a mapping layer — either store the `sessionKey` alongside each conversation, or derive it deterministically from `(agentId, conversationId)`.
