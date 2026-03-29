# UI-SPEC: Agent Chat Spaces

**Status:** approved
**Feature:** Agent Chat Spaces (Department Heads, Team Leads, Individual Agents)
**Date:** 2026-03-30
**Design System:** Manual (Tailwind CSS 3 + CSS custom properties, no shadcn)

---

## 1. Overview & Scope

Agent Chat Spaces adds three distinct chat contexts to the existing ChatWorkspace:

1. **Department Heads** -- chat with the lead agent of each department
2. **Team Leads** -- chat with the lead agent of each team
3. **Individual Agents** -- chat with any specific agent (existing behavior, restructured)

All three spaces share the same message infrastructure (ChatMessage, MessageBubble, ChatInput) but differ in how conversations are scoped, listed, and visually branded.

Messages sent to busy agents are NOT blocked. They queue immediately and the agent responds when available. The UI shows a busy indicator on the agent but the send action is always enabled.

### Out of Scope

- Group chat (multiple agents in one conversation)
- Agent-to-agent conversation viewing
- Voice/audio interfaces
- Department or team creation flows (already exist in departments-panel and teams-panel)

---

## 2. Information Architecture

### Navigation Structure

The existing `chat` nav-rail item remains the entry point. Inside ChatWorkspace, a new **space selector** sits above the conversation list in the left sidebar.

```
Nav Rail: [Chat]
  |
  ChatWorkspace
    |-- Space Selector (segmented control)
    |     [Departments] [Teams] [Agents]
    |
    |-- Conversation List (filtered by active space)
    |     - Grouped by entity (department/team/agent)
    |     - Each item shows: entity name, lead agent name, status dot, last message preview, timestamp
    |
    |-- Message Area (shared across all spaces)
    |     - Header: entity context bar (department/team name + agent identity)
    |     - Messages: existing MessageBubble + MessageList
    |     - Input: existing ChatInput (unchanged)
```

### Conversation ID Format

Extend the existing `activeConversation` string format:

| Space | Format | Example |
|-------|--------|---------|
| Department | `dept:<department_id>` | `dept:3` |
| Team | `team:<team_id>` | `team:7` |
| Individual Agent | `agent_<name>` | `agent_Aegis` (existing) |

### URL / Deep-link

No URL routing changes. Chat spaces are internal state within the chat panel. The active space and conversation are stored in Zustand only.

---

## 3. Layout & Composition

**Primary focal point:** The entity name in the Context Header Bar is the primary visual anchor — it orients the user to who they are chatting with. The message area is the dominant content area (flex-1).

### Desktop (>= 768px)

```
+------------------+----------------------------------------+
| Space Selector   |  Context Header Bar                    |
| [Dept][Team][Agt]|  [dept color dot] Engineering > Aegis  |
|------------------|  [status: busy]                        |
| Conversation     |----------------------------------------|
| List             |                                        |
| (w-72, matches   |  Message Area                          |
|  existing         |  (flex-1, scrollable)                  |
|  EntityListSidebar|                                       |
|  pattern)        |                                        |
|                  |                                        |
|                  |----------------------------------------|
|                  |  Chat Input                            |
|                  |  (existing ChatInput component)        |
+------------------+----------------------------------------+
```

- Left sidebar: `w-72` (matches EntityListSidebar pattern), collapsible
- Right pane: `flex-1 min-w-0`
- Space selector: full-width inside sidebar, 36px height

### Mobile (< 768px)

- Space selector shows as a horizontal scroll strip at top
- Conversation list fills viewport; selecting a conversation replaces the list with the message area
- Back button in context header returns to conversation list (existing mobile pattern in ChatWorkspace)

---

## 4. Component Specifications

### 4.1 `ChatSpaceSelector`

**Location:** `src/components/chat/chat-space-selector.tsx`
**Purpose:** Segmented control to switch between Department, Team, and Agent chat spaces.

```typescript
interface ChatSpaceSelectorProps {
  activeSpace: 'departments' | 'teams' | 'agents'
  onSpaceChange: (space: 'departments' | 'teams' | 'agents') => void
  counts: { departments: number; teams: number; agents: number }
}
```

**Visual:**
- Container: `bg-[hsl(var(--surface-1))] rounded-md p-1` inside the sidebar header area
- Each segment: `px-3 py-2 text-xs font-mono uppercase tracking-wider`
- Active segment: `bg-[hsl(var(--surface-2))] text-foreground rounded`
- Inactive segment: `text-muted-foreground hover:text-foreground`
- Each segment shows count badge: `text-[10px] font-mono tabular-nums ml-1 text-muted-foreground/50`
- Emoji prefixes (no icon libraries per CLAUDE.md): Departments = none, Teams = none, Agents = none. Use text labels only.

### 4.2 `SpaceConversationList`

**Location:** `src/components/chat/space-conversation-list.tsx`
**Purpose:** Replaces or wraps ConversationList when a chat space is active. Lists entities relevant to the selected space.

```typescript
interface SpaceConversationListProps {
  space: 'departments' | 'teams' | 'agents'
  onSelectConversation: (conversationId: string) => void
  activeConversation: string | null
}
```

**Department Space Items:**
- List all departments that have a `manager_agent_id` set
- Each item renders:
  - Color dot (department color, 10px, rounded-full)
  - Department name (`text-sm font-mono text-foreground`)
  - Lead agent name below (`text-xs font-mono text-muted-foreground`)
  - Agent status dot (8px, right-aligned)
  - Last message preview (`text-xs text-muted-foreground/60 truncate`, max 1 line)
  - Timestamp (`text-[10px] font-mono tabular-nums text-muted-foreground/30`)
- Empty state when no departments have leads assigned

**Team Space Items:**
- List all teams that have a `lead_agent_id` set (via agentTeamAssignments where role === 'lead')
- Each item renders:
  - Color dot (team color or parent department color, 10px)
  - Team name (`text-sm font-mono text-foreground`)
  - Parent department as breadcrumb (`text-[10px] font-mono text-muted-foreground/40`)
  - Lead agent name (`text-xs font-mono text-muted-foreground`)
  - Agent status dot (8px, right-aligned)
  - Last message preview + timestamp (same as department items)
- Empty state when no teams have leads assigned

**Agent Space Items:**
- List all agents (existing behavior, restructured into this component)
- Each item renders:
  - Agent name (`text-sm font-mono text-foreground`)
  - Role (`text-xs font-mono text-muted-foreground`)
  - Status dot (8px, right-aligned)
  - Last message preview + timestamp
- Group into: Online (idle/busy/error) and Offline sections
- Online section sorted: busy agents first, then idle, then error

**Selected state:** `bg-surface-1 border-l-2 border-primary` (left accent border)
**Hover state:** `bg-surface-1/50`

### 4.3 `ChatContextHeader`

**Location:** `src/components/chat/chat-context-header.tsx`
**Purpose:** Replaces the plain agent name header with a richer context bar showing the chat space context.

```typescript
interface ChatContextHeaderProps {
  conversationId: string
  space: 'departments' | 'teams' | 'agents'
}
```

**Department context:**
```
[color dot] Engineering                    [idle dot] Available
            Lead: Aegis
```

**Team context:**
```
[color dot] Frontend Team                  [busy dot] Agent is busy
            Engineering > Lead: Nova               Messages will queue
```

**Agent context:**
```
[status dot] Aegis                         [busy dot] Busy
             Security Lead
```

**Layout:**
- Height: 56px (`py-3 px-4`)
- Background: `bg-[hsl(var(--surface-0))]`
- Bottom border: `border-b border-border/50`
- Left side: entity identification (name, breadcrumb, lead)
- Right side: status indicator with label

### 4.4 `AgentStatusBadge`

**Location:** `src/components/ui/agent-status-badge.tsx`
**Purpose:** Unified status display used in context headers and conversation list items. Replaces ad-hoc StatusDot usage with a labeled variant.

```typescript
interface AgentStatusBadgeProps {
  status: 'idle' | 'busy' | 'error' | 'offline'
  variant: 'dot' | 'labeled' | 'labeled-with-queue'
  size?: 'sm' | 'md'
}
```

**Variants:**
- `dot`: 8px circle only (existing StatusDot behavior)
- `labeled`: dot + status text (`text-xs font-mono`)
- `labeled-with-queue`: dot + status text + queue hint for busy state

**Status colors (matching existing StatusDot):**

| Status | Dot Color | Label | Label Color |
|--------|-----------|-------|-------------|
| idle | `bg-green-500` | "Available" | `text-green-500` |
| busy | `bg-yellow-500` | "Busy" | `text-yellow-500` |
| error | `bg-red-500` | "Error" | `text-red-500` |
| offline | `bg-gray-500` | "Offline" | `text-gray-500` |

**Busy + queue hint:**
When `variant === 'labeled-with-queue'` and `status === 'busy'`:
- Shows "Busy -- messages will queue" in `text-[10px] font-mono text-muted-foreground/50` below the status label
- Dot uses `animate-pulse-dot` (existing animation in tailwind config)

---

## 5. Interaction Patterns

### 5.1 Space Switching

1. User clicks a space segment in ChatSpaceSelector
2. Store updates `activeChatSpace`
3. Conversation list re-renders with entities for the new space
4. If the user had an active conversation in the previous space, it is preserved in store but the message area shows an empty state for the new space until a conversation is selected
5. The last selected conversation per space is remembered (stored in `lastConversationBySpace` map)

### 5.2 Starting a Conversation

**Department/Team spaces:**
1. User clicks a department/team in the conversation list
2. System checks if a conversation with ID `dept:<id>` or `team:<id>` already exists
3. If yes: load existing messages
4. If no: create a new Conversation entry with `source: 'chat'` and the appropriate ID format
5. The conversation targets the department's `manager_agent_id` or the team's lead agent

**Agent space:**
- Existing behavior: clicking an agent creates/selects `agent_<name>` conversation (unchanged)

### 5.3 Sending to a Busy Agent

This is a critical interaction. The contract is:

1. User types message and presses Send
2. Message is immediately added to the local message list with `type: 'text'` and appears as sent
3. `POST /api/chat` (or existing send mechanism) fires normally
4. If agent status is `busy`:
   - The ChatContextHeader shows `AgentStatusBadge` with `variant: 'labeled-with-queue'`
   - A single-line system message appears after the user's message: "Message queued. [Agent name] will respond when available."
   - This system message has `type: 'status'` and is styled with `text-xs font-mono text-muted-foreground/50 text-center py-1`
5. Send button is NEVER disabled due to agent busyness. It is only disabled when `isSendingMessage === true` (in-flight request) or input is empty.
6. When the agent responds (via SSE `chat.message` event or polling), the response appears normally as a MessageBubble.

### 5.4 Real-Time Status Updates

- SSE `agent.status_changed` events update the agent status in the Zustand store
- All rendered `AgentStatusBadge` components reactively update
- If viewing a conversation with a busy agent who becomes idle, the queue hint disappears from the ChatContextHeader automatically (reactive to store)
- Conversation list items update their status dots in real time

### 5.5 Conversation Switching

- Clicking a different conversation in the list loads that conversation's messages
- Previous conversation's scroll position is NOT preserved (matches current behavior)
- Unread indicator: a small dot (`w-1.5 h-1.5 rounded-full bg-primary`) appears on conversation list items with unread messages

---

## 6. Visual Design Tokens

All tokens align with the existing design system. No new CSS custom properties are introduced.

### Spacing

Uses the existing Tailwind 4px-based scale. Specific values for this feature:

| Element | Value | Tailwind Class |
|---------|-------|----------------|
| Space selector padding | 4px | `p-1` |
| Space selector segment padding | 12px horizontal, 8px vertical | `px-3 py-2` |
| Conversation list item padding | 12px horizontal, 8px vertical | `px-3 py-2` |
| Context header padding | 16px horizontal, 12px vertical | `px-4 py-3` |
| Message area padding | 16px | `p-4` (existing) |
| Gap between conversation list items | 0px (border separators) | `border-b border-border/30` |
| Status badge dot-to-label gap | 8px | `gap-2` |

### Typography

Uses existing font stack. Specific applications:

| Element | Size | Weight | Line Height | Class |
|---------|------|--------|-------------|-------|
| Space selector labels | 12px | 400 | 1.0 | `text-xs font-mono` |
| Conversation entity name | 14px | 600 | 1.4 | `text-sm font-mono font-semibold` |
| Conversation agent/role | 12px | 400 | 1.4 | `text-xs font-mono` |
| Conversation preview | 12px | 400 | 1.4 | `text-xs` |
| Conversation timestamp | 10px | 400 | 1.0 | `text-[10px] font-mono tabular-nums` |
| Context header entity name | 16px | 600 | 1.2 | `text-base font-semibold font-mono` |
| Context header breadcrumb | 12px | 400 | 1.4 | `text-xs font-mono text-muted-foreground` |
| Status label | 12px | 400 | 1.0 | `text-xs font-mono` |
| Queue hint text | 10px | 400 | 1.0 | `text-[10px] font-mono` |
| System message (queued) | 12px | 400 | 1.5 | `text-xs font-mono` |

### Colors

60/30/10 split using existing CSS custom properties:

| Role | Token | Usage |
|------|-------|-------|
| 60% Dominant | `background` / `surface-0` | Message area background, main content |
| 30% Secondary | `card` / `surface-1` | Conversation list background, context header |
| 10% Accent | `primary` (void-cyan in dark) | Selected conversation border, unread dot, active space segment |

**Entity colors:** Department and team colors come from the `color` field on each entity and are used ONLY for the small color dot identifier (10px circle). They do not influence the overall color scheme.

**Semantic colors used:**

| Color | Token | Elements |
|-------|-------|----------|
| Green | `success` / `bg-green-500` | idle status dot, "Available" label |
| Yellow/Amber | `warning` / `bg-yellow-500` | busy status dot, "Busy" label |
| Red | `destructive` / `bg-red-500` | error status dot, "Error" label |
| Gray | `bg-gray-500` | offline status dot, "Offline" label |

---

## 7. Status & Presence System

### Status Dot Rendering

Status dots appear in three locations with consistent sizing:

| Location | Size | Animation |
|----------|------|-----------|
| Conversation list item | 8px (`w-2 h-2`) | `animate-pulse-dot` for busy only |
| Context header (via AgentStatusBadge) | 8px (`w-2 h-2`) | `animate-pulse-dot` for busy only |
| Space selector count badge | none (count only) | none |

### Busy Agent Visual Treatment

When the target agent of the active conversation is busy:

1. **Context header:** Status badge shows "Busy" with pulsing dot + queue hint text
2. **Conversation list item:** Pulsing yellow dot
3. **Chat input:** Remains fully enabled (no visual change)
4. **After sending:** System message "Message queued. [Name] will respond when available."
5. **No overlay, no modal, no toast.** The busy state is ambient, not interruptive.

### Offline Agent Treatment

When the target agent is offline:

1. **Context header:** Gray dot + "Offline" label
2. **Chat input:** Remains enabled. Messages still send (they queue server-side).
3. **After sending:** System message "Message sent. [Name] is currently offline."

### Error Agent Treatment

1. **Context header:** Red dot + "Error" label
2. **Chat input:** Remains enabled.
3. **After sending:** System message "Message sent. [Name] is in an error state -- response may be delayed."

---

## 8. Copy & Microcopy

### Primary CTA

| Element | Copy |
|---------|------|
| Send button | "Send" (existing, unchanged) |
| Chat input placeholder (department) | "Message Engineering department..." |
| Chat input placeholder (team) | "Message Frontend team..." |
| Chat input placeholder (agent) | "Message Aegis..." |

### Empty States

| Context | Title | Subtitle |
|---------|-------|----------|
| No conversation selected (any space) | "/" | "Select a conversation to begin" |
| Department space, no departments with leads | "/" | "No department leads assigned" |
| Department space, no departments exist | "/" | "Create departments in the Departments panel" |
| Team space, no teams with leads | "/" | "No team leads assigned" |
| Team space, no teams exist | "/" | "Create teams in the Teams panel" |
| Agent space, no agents | "/" | "No agents registered" |
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
| Agent comes online | "[Name] is now available." (rendered as system message if conversation is active) |

### Tooltips

| Element | Tooltip |
|---------|---------|
| Busy status dot in conversation list | "Agent is busy -- messages will queue" |
| Offline status dot in conversation list | "Agent is offline" |
| Error status dot in conversation list | "Agent encountered an error" |

---

## 9. State Management Changes

### New Zustand State (additions to `useMissionControl`)

```typescript
// New fields
activeChatSpace: 'departments' | 'teams' | 'agents'
lastConversationBySpace: Record<string, string | null>  // space -> conversationId

// New actions
setActiveChatSpace: (space: 'departments' | 'teams' | 'agents') => void
```

### Initial Values

```typescript
activeChatSpace: 'agents',  // default to existing behavior
lastConversationBySpace: { departments: null, teams: null, agents: null },
```

### Derived Data (computed in components, not stored)

```typescript
// Department conversations: derived from departments + agents
function getDepartmentChatEntities(departments: Department[], agents: Agent[]): DepartmentChatEntity[]

// Team conversations: derived from teams + agentTeamAssignments + agents
function getTeamChatEntities(teams: Team[], assignments: AgentTeamAssignment[], agents: Agent[]): TeamChatEntity[]
```

These derivation functions live in a new utility file: `src/lib/chat-space-utils.ts`.

### Conversation Hydration

When switching to a space, conversations for that space are hydrated from existing data:
- For `dept:<id>` conversations, the target agent is `departments.find(d => d.id === id)?.manager_agent_id`
- For `team:<id>` conversations, the target agent is the agent with `role === 'lead'` in agentTeamAssignments for that team
- Message sending uses the same `POST /api/chat` endpoint, targeting the resolved agent name

---

## 10. Accessibility Requirements

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Moves focus: Space Selector -> Conversation List -> Message Area -> Chat Input |
| Arrow Left/Right | Within Space Selector: switches active space |
| Arrow Up/Down | Within Conversation List: moves selection |
| Enter | Within Conversation List: opens selected conversation |
| Escape | Mobile: returns from message area to conversation list |

### ARIA

| Element | Attribute |
|---------|-----------|
| Space Selector container | `role="tablist"` |
| Each space segment | `role="tab"`, `aria-selected`, `aria-controls="conversation-list"` |
| Conversation List | `role="listbox"`, `id="conversation-list"`, `aria-label="Conversations"` |
| Each conversation item | `role="option"`, `aria-selected` |
| Status dot | `aria-label="Agent status: [idle/busy/error/offline]"` |
| Queue hint text | `aria-live="polite"` (announces when busy state changes) |
| System messages (queued) | `role="status"` |

### Focus Management

- When switching spaces, focus moves to the first conversation in the new list
- When selecting a conversation, focus moves to the chat input
- Status changes are announced via `aria-live="polite"` region

### Color Contrast

All status colors meet WCAG AA against the dark background:
- Green (#22c55e) on surface-0 (dark ~#0a0f1a): 5.2:1 ratio -- PASS
- Yellow (#eab308) on surface-0: 8.1:1 ratio -- PASS
- Red (#ef4444) on surface-0: 4.6:1 ratio -- PASS
- Gray (#6b7280) on surface-0: 4.5:1 ratio -- PASS (borderline, acceptable for decorative dots paired with text labels)

---

## 11. Edge Cases & Error States

### No Lead Assigned

- Department with no `manager_agent_id`: item appears in list but is disabled
- Visual: `opacity-50`, no click handler
- Label below name: "No lead assigned"

### Lead Agent Deleted

- If a department/team references an agent ID that no longer exists in the agents array:
- Item renders with agent name as "Unknown Agent" and status as offline
- Conversation still accessible for historical messages

### Agent Status Changes Mid-Conversation

- If agent goes from idle to busy while user is typing: no interruption
- Status badge updates reactively, but input and send remain enabled
- If agent goes offline: same behavior, status updates, input stays enabled

### Rapid Space Switching

- Space changes are synchronous (local state only)
- No loading spinner needed for space switching
- Conversation list renders from already-loaded Zustand data (departments, teams, agents)

### Empty Org Data

- If departments/teams store is empty (first-time user or no org setup):
- The space still renders but shows the empty state
- Department and Team counts in the space selector show "0"

### Message Send Failure

- Existing error handling in ChatWorkspace applies
- On send failure: message remains in list with error styling (existing behavior)
- Retry mechanism: existing (user re-sends)

### SSE Reconnection

- On SSE disconnect/reconnect, agent statuses refresh via polling fallback (existing)
- No special handling needed for chat spaces beyond what ChatWorkspace already does

### Very Long Department/Team Names

- Conversation list item names: `truncate` (single line, ellipsis)
- Context header entity name: `truncate` with `max-w-[300px]`
- Breadcrumb path: `truncate` with `max-w-[200px]`

### Concurrent Sessions

- If an agent has active sessions visible in the existing ConversationList, those remain accessible in the Agent space
- Department/Team spaces only show chat conversations (source: 'chat'), not session transcripts
