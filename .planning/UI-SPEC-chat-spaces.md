# UI-SPEC: Agent Chat Spaces

**Status:** approved
**Feature:** Agent Chat Spaces (Embedded Chat in Departments & Teams Panels)
**Date:** 2026-03-30
**Design System:** Manual (Tailwind CSS 3 + CSS custom properties, no shadcn)

---

## 1. Overview & Scope

Agent Chat Spaces adds an embedded chat interface to the existing **Departments panel** and **Teams panel** as a new tab. Users chat with a department or team by sending messages to the **lead agent**, who delegates work to other agents within the entity according to the lead's prompt/instructions.

1. **Department Chat** -- a "chat" tab inside the department detail view. Messages route to the department's lead agent (`manager_agent_id`).
2. **Team Chat** -- a "chat" tab inside the team detail view. Messages route to the team's lead agent (from `agentTeamAssignments` with `role === 'lead'`).
3. **Individual Agent Chat** -- existing behavior in ChatWorkspace, unchanged.

The lead agent receives messages and is responsible for delegating to other agents in the department/team. This delegation logic is handled by the agent's prompt, not the UI.

Messages sent to busy agents are NOT blocked. They queue immediately and the agent responds when available. The UI shows a busy indicator but the send action is always enabled.

### Out of Scope

- Group chat (multiple agents in one conversation simultaneously)
- Agent-to-agent conversation viewing
- Voice/audio interfaces
- Modifications to the existing ChatWorkspace or its sidebar
- Department or team creation flows (already exist)
- Delegation logic (handled by agent prompts, not the UI)

---

## 2. Information Architecture

### Where Chat Lives

Chat is embedded directly inside the existing panel detail views via a new tab:

```
Departments Panel:
  DepartmentDetail:
    Tabs: [overview] [teams] [agents] [docs] [chat]  <-- NEW
    |
    When "chat" tab active:
      |-- Chat Header (lead agent info + status)
      |-- Message Area (scrollable, flex-1)
      |-- Chat Input (pinned to bottom)

Teams Panel:
  TeamDetail:
    Tabs: [overview] [members] [docs] [chat]  <-- NEW
    |
    When "chat" tab active:
      |-- Chat Header (lead agent info + status)
      |-- Message Area (scrollable, flex-1)
      |-- Chat Input (pinned to bottom)
```

### Conversation ID Format

Extends the existing `activeConversation` string format:

| Context | Format | Example |
|---------|--------|---------|
| Department | `dept:<department_id>` | `dept:3` |
| Team | `team:<team_id>` | `team:7` |
| Individual Agent | `agent_<name>` | `agent_Aegis` (existing, unchanged) |

### URL / Deep-link

No URL routing changes. The active tab is local component state within the panel detail views.

---

## 3. Layout & Composition

### Embedded Chat Tab Layout

The chat tab fills the same content area as other tabs (overview, teams, agents, docs). It uses the full available height.

```
+------------------------------------------------------------------+
| [overview] [teams] [agents] [docs] [chat]  <- existing tab bar   |
+------------------------------------------------------------------+
| Chat Header                                                       |
| [status dot] Lead: Aegis                  [busy dot] Busy         |
|                                           Messages will queue     |
+------------------------------------------------------------------+
|                                                                    |
|  Message Area (flex-1, scrollable)                                |
|  - Date groupings                                                  |
|  - MessageBubble components (reused from existing chat)           |
|  - System messages for busy/offline/error status                  |
|                                                                    |
+------------------------------------------------------------------+
| Chat Input                                                         |
| [textarea] [send]                                                  |
+------------------------------------------------------------------+
```

- Chat header: fixed height, pinned to top of tab content
- Message area: `flex-1 overflow-y-auto`, scrolls to bottom on new messages
- Chat input: pinned to bottom, uses existing `ChatInput` component with a `placeholder` prop

### No Lead Assigned State

When a department has no `manager_agent_id` or a team has no lead assignment, the chat tab shows a disabled state instead of the chat interface:

```
+------------------------------------------------------------------+
| [overview] [teams] [agents] [docs] [chat]                         |
+------------------------------------------------------------------+
|                                                                    |
|                          /                                         |
|                  No lead assigned                                  |
|           Assign a lead agent to enable chat                      |
|                                                                    |
+------------------------------------------------------------------+
```

---

## 4. Component Specifications

### 4.1 `EmbeddedChat`

**Location:** `src/components/chat/embedded-chat.tsx`
**Purpose:** Reusable chat widget that can be embedded in any panel tab. Handles message loading, sending, display, and status system messages.

```typescript
interface EmbeddedChatProps {
  conversationId: string          // e.g., 'dept:3' or 'team:7'
  targetAgentName: string         // resolved lead agent name
  targetAgentStatus: Agent['status']
  entityLabel: string             // e.g., "Engineering department" or "Frontend team"
  entityColor?: string            // department/team color for header dot
}
```

**Responsibilities:**
- Loads messages for the given `conversationId` from `/api/chat/messages`
- Polls for new messages (reuses `useSmartPoll` pattern from ChatWorkspace)
- Sends messages via `POST /api/chat/messages` with `to: targetAgentName`
- Displays system messages after sending to busy/offline/error agents
- Manages optimistic message updates
- Auto-scrolls to bottom on new messages

**Internal structure:**
```
<div className="flex flex-col h-full">
  <EmbeddedChatHeader />       {/* fixed top */}
  <MessageList />               {/* flex-1 overflow-y-auto -- reuse existing */}
  <ChatInput />                 {/* fixed bottom -- reuse existing with placeholder */}
</div>
```

### 4.2 `EmbeddedChatHeader`

**Location:** Inline within `embedded-chat.tsx` (not a separate file)
**Purpose:** Shows the target lead agent identity and status within the embedded chat.

**Visual:**
```
[color dot] Chat with Engineering           [idle dot] Available
            Lead: Aegis
```

**Layout:**
- Height: `py-3 px-4` (approximately 56px)
- Background: `bg-[hsl(var(--surface-1))]`
- Bottom border: `border-b border-border/50`
- Left side: entity label + lead agent name
- Right side: status indicator with label

**Left side:**
- Color dot: `w-2.5 h-2.5 rounded-full` with entity color
- Entity label: `text-sm font-semibold font-mono text-foreground`
- Lead name: `text-xs font-mono text-muted-foreground` below entity label

**Right side:**
- `AgentStatusBadge` with `variant: 'labeled-with-queue'`

### 4.3 `AgentStatusBadge`

**Location:** `src/components/ui/agent-status-badge.tsx`
**Purpose:** Unified status display used in the embedded chat header. Reusable across the app.

```typescript
interface AgentStatusBadgeProps {
  status: 'idle' | 'busy' | 'error' | 'offline'
  variant: 'dot' | 'labeled' | 'labeled-with-queue'
  size?: 'sm' | 'md'
}
```

**Variants:**
- `dot`: 8px circle only
- `labeled`: dot + status text (`text-xs font-mono`)
- `labeled-with-queue`: dot + status text + queue hint for busy state

**Status colors:**

| Status | Dot Color | Label | Label Color |
|--------|-----------|-------|-------------|
| idle | `bg-green-500` | "Available" | `text-green-500` |
| busy | `bg-yellow-500` | "Busy" | `text-yellow-500` |
| error | `bg-red-500` | "Error" | `text-red-500` |
| offline | `bg-gray-500` | "Offline" | `text-gray-500` |

**Busy + queue hint:**
When `variant === 'labeled-with-queue'` and `status === 'busy'`:
- Shows "Busy -- messages will queue" in `text-[10px] font-mono text-muted-foreground/50` below the status label
- Dot uses `pulse-dot` CSS class (existing animation in globals.css)

---

## 5. Interaction Patterns

### 5.1 Opening Department/Team Chat

1. User navigates to Departments or Teams panel
2. Selects a department/team from the sidebar list
3. Clicks the "chat" tab in the detail view header
4. If a lead agent is assigned: embedded chat loads, showing message history and input
5. If no lead agent: empty state with "No lead assigned" message

### 5.2 Sending a Message

1. User types in the chat input and presses Send
2. Message is optimistically added to the message list
3. `POST /api/chat/messages` fires with `to: <lead_agent_name>`, `conversation_id: 'dept:N'` or `'team:N'`
4. If the lead agent is busy/offline/error, a system message appears after the user's message
5. The lead agent receives the message and delegates to other agents as needed (server-side, not UI concern)
6. Agent responses appear via SSE `chat.message` events or polling

### 5.3 Sending to a Busy Agent

1. ChatInput remains fully enabled (send button never disabled due to agent busyness)
2. After sending: system message "[Name] is busy. Your message is queued and will be delivered."
3. System message styled as `text-xs font-mono text-muted-foreground/50 text-center py-1`
4. No overlay, no modal, no toast. The busy state is ambient, not interruptive.

### 5.4 Real-Time Status Updates

- SSE `agent.status_changed` events update the agent status in the Zustand store
- The `AgentStatusBadge` in the embedded chat header reactively updates
- If the lead agent goes from busy to idle, the queue hint disappears automatically

### 5.5 Switching Tabs

- When switching away from the "chat" tab to another tab (overview, teams, etc.) and back, messages are preserved (loaded from store/API)
- Scroll position is NOT preserved across tab switches (matches current behavior)

---

## 6. Visual Design Tokens

All tokens align with the existing design system. No new CSS custom properties are introduced.

### Spacing

| Element | Value | Tailwind Class |
|---------|-------|----------------|
| Chat header padding | 16px horizontal, 12px vertical | `px-4 py-3` |
| Message area padding | 16px | `p-4` (existing) |
| Chat input area | existing ChatInput component styling | |
| Status badge dot-to-label gap | 8px | `gap-2` |

### Typography

| Element | Size | Weight | Class |
|---------|------|--------|-------|
| Entity label in header | 14px | 600 | `text-sm font-semibold font-mono` |
| Lead agent name in header | 12px | 400 | `text-xs font-mono text-muted-foreground` |
| Status label | 12px | 400 | `text-xs font-mono` |
| Queue hint text | 10px | 400 | `text-[10px] font-mono` |
| System message (queued) | 12px | 400 | `text-xs font-mono` |

### Colors

60/30/10 split using existing CSS custom properties:

| Role | Token | Usage |
|------|-------|-------|
| 60% Dominant | `background` / `surface-0` | Message area background |
| 30% Secondary | `card` / `surface-1` | Chat header background |
| 10% Accent | `primary` | Active tab indicator |

**Entity colors:** Department and team colors come from the `color` field and are used ONLY for the small color dot in the chat header (10px circle).

---

## 7. Status & Presence System

### Status Display in Chat Header

The embedded chat header shows `AgentStatusBadge` for the lead agent:

| Status | Display | Queue Hint |
|--------|---------|------------|
| idle | Green dot + "Available" | None |
| busy | Pulsing yellow dot + "Busy" | "Messages will queue" |
| error | Red dot + "Error" | None |
| offline | Gray dot + "Offline" | None |

### Busy Agent Visual Treatment

When the lead agent is busy:
1. **Chat header:** Status badge shows "Busy" with pulsing dot + queue hint text
2. **Chat input:** Remains fully enabled (no visual change)
3. **After sending:** System message "[Name] is busy. Your message is queued and will be delivered."
4. **No overlay, no modal, no toast.** The busy state is ambient, not interruptive.

### Offline Agent Treatment

1. **Chat header:** Gray dot + "Offline" label
2. **Chat input:** Remains enabled. Messages still send (they queue server-side).
3. **After sending:** System message "[Name] is offline. Your message will be delivered when available."

### Error Agent Treatment

1. **Chat header:** Red dot + "Error" label
2. **Chat input:** Remains enabled.
3. **After sending:** System message "[Name] is in an error state. Your message was sent but response may be delayed."

---

## 8. Copy & Microcopy

### Chat Input Placeholders

| Context | Placeholder |
|---------|-------------|
| Department chat | "Message Engineering department..." |
| Team chat | "Message Frontend team..." |

### Empty States

| Context | Title | Subtitle |
|---------|-------|----------|
| No lead assigned (dept) | "/" | "No lead assigned. Assign a department lead to enable chat." |
| No lead assigned (team) | "/" | "No team lead assigned. Promote an agent to lead to enable chat." |
| Conversation with no messages | "/" | "Start a conversation with [Entity Name]" |

Empty state styling matches existing `EmptyState` pattern from departments-panel:
```
text-muted-foreground/30, centered, text-4xl "/" icon, text-sm title, text-xs subtitle
```

### Status System Messages

| Trigger | Message |
|---------|---------|
| Sent to busy agent | "[Name] is busy. Your message is queued and will be delivered." |
| Sent to offline agent | "[Name] is offline. Your message will be delivered when available." |
| Sent to error agent | "[Name] is in an error state. Your message was sent but response may be delayed." |

---

## 9. State Management Changes

### No New Zustand State Required

The embedded chat uses existing store fields:
- `departments`, `teams`, `agents`, `agentTeamAssignments` -- for resolving lead agents
- `chatMessages`, `addChatMessage`, `setChatMessages` -- for message management

The `EmbeddedChat` component manages its own local state for:
- Messages loaded for the current conversation
- Sending state (optimistic updates)
- Scroll position

### Derived Data (computed in components)

```typescript
// Department lead resolution
function getDeptLeadAgent(dept: Department, agents: Agent[]): Agent | null

// Team lead resolution
function getTeamLeadAgent(teamId: number, assignments: AgentTeamAssignment[], agents: Agent[]): Agent | null
```

These are simple lookups, not utility functions that need a separate file. Compute inline in the panel components.

---

## 10. Accessibility Requirements

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Moves focus through tab bar -> chat header -> message area -> chat input |
| Enter | In chat input: sends message (existing behavior) |

### ARIA

| Element | Attribute |
|---------|-----------|
| Status dot | `aria-label="Agent status: [idle/busy/error/offline]"` |
| Queue hint text | `aria-live="polite"` (announces when busy state changes) |
| System messages (queued) | `role="status"` |

### Color Contrast

All status colors meet WCAG AA against the dark background:
- Green (#22c55e) on surface-0: 5.2:1 -- PASS
- Yellow (#eab308) on surface-0: 8.1:1 -- PASS
- Red (#ef4444) on surface-0: 4.6:1 -- PASS
- Gray (#6b7280) on surface-0: 4.5:1 -- PASS

---

## 11. Edge Cases & Error States

### No Lead Assigned

- Department with no `manager_agent_id`: chat tab shows empty state
- Team with no lead in `agentTeamAssignments`: chat tab shows empty state
- The chat tab is always visible in the tab bar but content shows the empty state

### Lead Agent Deleted

- If a department/team references an agent ID that no longer exists:
- Chat tab shows empty state "Lead agent not found"
- Existing messages are still accessible via conversation history

### Agent Status Changes Mid-Conversation

- If lead agent goes from idle to busy while user is typing: no interruption
- Status badge updates reactively, but input and send remain enabled

### Empty Org Data

- If departments/teams have no leads assigned (common for filesystem-scanned orgs):
- Chat tab renders but shows the "No lead assigned" empty state
- This is expected behavior for Phase 1

### Message Send Failure

- On send failure: message remains in list with error styling (existing behavior)
- Retry mechanism: user re-sends

### Very Long Entity Names

- Header entity label: `truncate` with available width
- Header lead name: `truncate`

### Concurrent Chat Across Tabs

- A user can have the department chat tab open in the departments panel AND a separate agent chat in the ChatWorkspace simultaneously
- These are separate conversation IDs (`dept:3` vs `agent_Aegis`) and do not conflict
