# Phase 1: Agent Chat Spaces UI - Research

**Researched:** 2026-03-30
**Domain:** React/Next.js UI, Zustand state management, SSE event handling, chat workspace extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Space Selector:**
- Segmented control: three segments Departments, Teams, Agents
- Container: `bg-[hsl(var(--surface-1))] rounded-md p-1` inside sidebar header
- Each segment: `px-3 py-2 text-xs font-mono uppercase tracking-wider`
- Active: `bg-[hsl(var(--surface-2))] text-foreground rounded`
- Inactive: `text-muted-foreground hover:text-foreground`
- Count badges: `text-[10px] font-mono tabular-nums ml-1 text-muted-foreground/50`
- Text labels only, no icons/emoji
- ARIA: `role="tablist"` container, `role="tab"` segments, arrow key navigation

**SpaceConversationList:**
- Replaces/wraps ConversationList when a chat space is active
- Department items: color dot (10px) + dept name + lead agent name + status dot (8px) + last message preview + timestamp
- Team items: color dot (10px) + team name + parent dept breadcrumb + lead agent name + status dot (8px) + preview + timestamp
- Agent items: agent name + role + status dot (8px) + preview + timestamp; grouped Online (busy first, idle, error) and Offline
- Selected state: `bg-surface-1 border-l-2 border-primary`
- Hover state: `bg-surface-1/50`
- Item padding: `px-3 py-2`, separator: `border-b border-border/30`
- Departments without `manager_agent_id`: disabled, `opacity-50`, "No lead assigned"
- Teams without lead: disabled similarly
- ARIA: `role="listbox"` container, `role="option"` items, arrow up/down navigation

**ChatContextHeader:**
- Height 56px (`py-3 px-4`), `bg-[hsl(var(--surface-0))]`, `border-b border-border/50`
- Left: entity name (`text-base font-semibold font-mono`) + breadcrumb/lead info (`text-xs font-mono text-muted-foreground`)
- Right: AgentStatusBadge with labeled or labeled-with-queue variant
- Long names: `truncate` with `max-w-[300px]` on name, `max-w-[200px]` on breadcrumb

**AgentStatusBadge:**
- Three variants: `dot` (8px), `labeled` (dot + text), `labeled-with-queue` (dot + text + queue hint)
- Sizes: `sm` (default), `md`
- idle=green-500, busy=yellow-500, error=red-500, offline=gray-500
- Busy dot: `animate-pulse-dot` (use `pulse-dot` CSS class from globals.css)
- Queue hint: `text-[10px] font-mono text-muted-foreground/50`

**Conversation ID Format:**
- Department: `dept:<department_id>`
- Team: `team:<team_id>`
- Agent: `agent_<name>` (existing, unchanged)

**State Management:**
- New fields in `useMissionControl`: `activeChatSpace: 'departments' | 'teams' | 'agents'`, `lastConversationBySpace: Record<string, string | null>`
- New action: `setActiveChatSpace`
- Default: `activeChatSpace: 'agents'`
- Derived data in components: `getDepartmentChatEntities()`, `getTeamChatEntities()`
- Utility file: `src/lib/chat-space-utils.ts`

**Message Sending:**
- Send button NEVER disabled due to agent status
- System messages after sending to busy/offline/error: `type: 'status'`, styled `text-xs font-mono text-muted-foreground/50 text-center py-1`, `role="status"`

**Space Switching:**
- Synchronous, no loading spinners
- `lastConversationBySpace` preserves last selection per space

**Layout:**
- Desktop (>=768px): left sidebar `w-72`, right pane `flex-1 min-w-0`
- Mobile (<768px): horizontal scroll strip, conversation list fills viewport, selecting conversation replaces list, back button returns

### Claude's Discretion
- Internal component decomposition within specified components
- File organization for shared utilities
- Exact implementation of the mobile back button
- Scroll restoration strategy within message area
- How to integrate with existing ConversationList (wrap vs replace)
- Testing approach

### Deferred Ideas (OUT OF SCOPE)
- Group chat (multiple agents in one conversation)
- Agent-to-agent conversation viewing
- Voice/audio interfaces
- URL routing changes for chat spaces
- Scroll position preservation across conversation switches
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-CHAT-SPACES | Space selector, conversation lists, context headers, status badges for department/team/agent chat spaces within ChatWorkspace | Full coverage: component structure, Zustand patterns, SSE integration, existing patterns all researched |
</phase_requirements>

---

## Summary

Phase 1 adds three chat space contexts (Departments, Teams, Agents) to the existing ChatWorkspace. The codebase is a mature Next.js 16 + Zustand app with well-defined patterns. The primary work is: (1) extending the Zustand store with two new fields, (2) creating four new components, (3) writing a utility module for entity derivation, and (4) wiring everything into `ChatWorkspace`.

The existing infrastructure handles all the hard parts already: SSE delivers `agent.status_changed` events and calls `updateAgent` in the store reactively; `POST /api/chat/messages` sends messages regardless of agent status; the `useServerEvents` hook runs globally in the app. New components need only subscribe to existing store slices — no new APIs are required for this phase.

A critical pre-existing bug was found: `conversation-list.tsx` has `STATUS_COLORS` with `busy=green-500` and `idle=yellow-500` — **the opposite of the spec and `StatusDot`**. The new `AgentStatusBadge` must use the correct mapping (`idle=green-500`, `busy=yellow-500`) and this bug should be noted but not necessarily fixed in scope.

**Primary recommendation:** Build the four new components in `src/components/chat/` and `src/components/ui/`, extend the store with minimal new state, wire into `ChatWorkspace` by replacing the `<ConversationList>` and header blocks with space-aware equivalents. All derivation logic goes in `src/lib/chat-space-utils.ts`.

---

## Standard Stack

No new packages are needed. All dependencies are already installed.

### Core (existing, confirmed in codebase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16 (App Router) | Page/API routing | Project constraint |
| React | 19 | UI rendering | Project constraint |
| TypeScript | 5 | Type safety | Project constraint |
| Zustand | (installed) | Client state with `subscribeWithSelector` | Already used for all store state including agents, departments, teams, chatMessages |
| Tailwind CSS | 3 | Styling | Project constraint; all design tokens already defined |
| better-sqlite3 | (installed) | Database | Not touched in this phase (UI only) |

### No New Packages Required

This phase is entirely UI-layer work. All state management, data fetching, SSE, and component patterns are already established. No `npm install` step is needed.

---

## Architecture Patterns

### File Layout

```
src/
├── components/
│   ├── chat/
│   │   ├── chat-workspace.tsx        # MODIFY: wire in new components
│   │   ├── chat-space-selector.tsx   # NEW: segmented control
│   │   ├── space-conversation-list.tsx # NEW: entity list per space
│   │   ├── chat-context-header.tsx   # NEW: context bar with status badge
│   │   ├── conversation-list.tsx     # UNCHANGED (still renders in Agents space)
│   │   └── chat-input.tsx            # MODIFY: add placeholder prop forwarding
│   └── ui/
│       └── agent-status-badge.tsx    # NEW: unified status component
└── lib/
    └── chat-space-utils.ts           # NEW: getDepartmentChatEntities, getTeamChatEntities
```

### Pattern 1: Zustand Store Extension

The store uses `subscribeWithSelector` middleware. New fields are added to the existing `MissionControlStore` interface and initialized in the `create` call.

```typescript
// Source: src/store/index.ts (existing pattern)

// In interface MissionControlStore:
activeChatSpace: 'departments' | 'teams' | 'agents'
lastConversationBySpace: Record<string, string | null>
setActiveChatSpace: (space: 'departments' | 'teams' | 'agents') => void

// In create(...):
activeChatSpace: 'agents',
lastConversationBySpace: { departments: null, teams: null, agents: null },
setActiveChatSpace: (space) => set({ activeChatSpace: space }),
```

Components subscribe with fine-grained selectors (existing pattern throughout codebase):
```typescript
const activeChatSpace = useMissionControl((s) => s.activeChatSpace)
const departments = useMissionControl((s) => s.departments)
```

### Pattern 2: ChatWorkspace Integration

`ChatWorkspace` currently renders `<ConversationList>` in the sidebar and a plain text header for the active conversation. The integration point is:

```typescript
// CURRENT (src/components/chat/chat-workspace.tsx lines 391-416):
{showConversations && !focusMode && (
  <div className={`${isMobile ? 'w-full' : 'w-56 border-r border-border'} flex-shrink-0`}>
    <ConversationList onNewConversation={handleNewConversation} />
  </div>
)}
// ...
{activeConversation && (
  <div className="bg-surface-1 flex flex-shrink-0 items-center gap-2 ...">
    {/* plain text header */}
  </div>
)}
```

The new pattern replaces these two blocks. The sidebar div width must change from `w-56` to `w-72` (to match EntityListSidebar and the spec). The space selector sits above the conversation list within the sidebar div.

### Pattern 3: EmptyState Component

`EmptyState` is a local function in `departments-panel.tsx`. For ChatWorkspace, replicate the same pattern inline or extract to a small shared component:

```typescript
// Source: src/components/panels/departments-panel.tsx lines 54-68
function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
      <span className="text-4xl font-mono mb-3">/</span>
      <span className="text-sm font-mono">{title}</span>
      <span className="text-xs font-mono mt-1 text-muted-foreground/20">{subtitle}</span>
    </div>
  )
}
```

### Pattern 4: StatusDot (existing)

`StatusDot` lives in `src/components/ui/dnd-org-helpers.tsx`. It uses `Agent['status']` directly:
- `idle` → `bg-green-500`
- `busy` → `bg-yellow-500`
- `error` → `bg-red-500`
- `offline` (or any other) → `bg-gray-500`

`AgentStatusBadge` supersedes this for chat use cases. The `labeled-with-queue` variant is new. The existing `StatusDot` is not changed.

### Pattern 5: SSE Agent Status Updates

`useServerEvents` (mounted globally via the app shell) handles `agent.status_changed` by calling `updateAgent(event.data.id, event.data)`. This writes into `useMissionControl.agents[]`. All `AgentStatusBadge` components that subscribe to `useMissionControl((s) => s.agents)` (or derive agent status from it) receive reactive updates automatically. No additional SSE wiring is needed.

### Pattern 6: Mobile Responsive Pattern

`ChatWorkspace` already detects mobile via `window.innerWidth < 768` and toggles `showConversations`. The existing `handleBackToList` function sets `showConversations = true`. The new back button in `ChatContextHeader` on mobile should call the same handler (passed as a prop or via a callback).

### Pattern 7: Sending Messages

The `handleSend` function in `ChatWorkspace` parses the `agent_<name>` format to extract `to`. For `dept:` and `team:` conversation IDs, the same function must resolve the target agent. This is done by looking up `manager_agent_id` on the department or the lead assignment from `agentTeamAssignments`. The resolved agent name is passed as `to` in the `POST /api/chat/messages` body.

```typescript
// CURRENT agent resolution (chat-workspace.tsx line 138-141):
if (!to && activeConversation.startsWith('agent_')) {
  to = activeConversation.replace('agent_', '')
}

// NEW: extend with dept/team resolution:
if (!to && activeConversation.startsWith('dept:')) {
  const deptId = Number(activeConversation.replace('dept:', ''))
  const dept = departments.find(d => d.id === deptId)
  if (dept?.manager_agent_id) {
    const agent = agents.find(a => a.id === dept.manager_agent_id)
    to = agent?.name ?? null
  }
}
if (!to && activeConversation.startsWith('team:')) {
  const teamId = Number(activeConversation.replace('team:', ''))
  const lead = agentTeamAssignments.find(a => a.team_id === teamId && a.role === 'lead')
  if (lead) {
    const agent = agents.find(a => a.id === lead.agent_id)
    to = agent?.name ?? null
  }
}
```

### Pattern 8: pulse-dot CSS Class

The animation class is `pulse-dot` (CSS class, not Tailwind `animate-` utility). It is defined in `src/app/globals.css`:
```css
.pulse-dot {
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
}
```
Use `className="... pulse-dot"` on the busy status dot. The CONTEXT.md refers to `animate-pulse-dot` as a Tailwind class, but the actual implementation is the `pulse-dot` CSS class.

### Pattern 9: Conversation Creation for Dept/Team Spaces

When a user selects a dept/team conversation that has no existing `Conversation` record in the store, the component calls `setActiveConversation(convId)`. The `loadMessages` effect in `ChatWorkspace` fetches messages from `/api/chat/messages?conversation_id=dept:3`. If no messages exist, the API returns an empty array, showing the "Start a conversation" empty state. No explicit conversation creation step is needed — the first message send creates the conversation record server-side via the existing `/api/chat/messages` POST handler.

### Anti-Patterns to Avoid

- **Storing derived data in Zustand:** `getDepartmentChatEntities()` and `getTeamChatEntities()` must be computed in components from existing store slices. Do not add `departmentChatEntities` or `teamChatEntities` arrays to the store.
- **Adding loading state for space switches:** Space switching is synchronous local state — no loading spinners.
- **Disabling send for non-idle agents:** The send button must remain enabled regardless of agent status. Only disable for empty input or in-flight request.
- **Using `animate-pulse` (Tailwind built-in):** Use the `pulse-dot` CSS class, not Tailwind's `animate-pulse`. They have different keyframes.
- **Blocking dept/team conversations on missing lead:** Items without a lead render as disabled (`opacity-50`, no click handler) rather than being filtered out entirely.

---

## Data Model: Key Findings

### Department (from `src/store/index.ts`)

```typescript
export interface Department {
  id: number
  name: string
  description?: string
  manager_agent_id?: number    // optional — departments from filesystem scan do NOT have this set
  color?: string
  created_at: number
  updated_at: number
}
```

**Critical finding:** `manager_agent_id` on Department is defined in the store type but is NOT populated by the filesystem org scanner (`org-scanner.ts`). The scanner only sets `id`, `name`, `description`, `color`, `created_at`, `updated_at`. The `manager_agent_id` field would only be set via manual DB operations or future API endpoints that are not yet implemented.

This means: in the current system, most departments will have `manager_agent_id === undefined`. The SpaceConversationList will show most departments as disabled ("No lead assigned") unless lead assignment is implemented separately. The plan must handle this gracefully — this is not a bug in Phase 1, it is expected behavior.

### Team (from `src/store/index.ts`)

```typescript
export interface Team {
  id: number
  name: string
  description?: string
  department_id: number
  lead_agent_id?: number       // optional — also NOT populated by filesystem scanner
  color?: string
  created_at: number
  updated_at: number
}
```

Team lead assignment uses `agent_team_assignments` with `role: 'lead'`, not `lead_agent_id` directly. The spec's `getTeamChatEntities` function uses `agentTeamAssignments` to find leads (not `team.lead_agent_id`). This is correct — use `agentTeamAssignments` as the source of truth.

### AgentTeamAssignment (from `src/store/index.ts`)

```typescript
export interface AgentTeamAssignment {
  agent_id: number
  team_id: number
  role: 'member' | 'lead'
  assigned_at: number
}
```

The filesystem scanner populates `role` from `metadata.assignmentRole` parsed from `AGENT.md`. Only agents with `role: 'lead'` in their `AGENT.md` metadata get the `lead` role. Team leads ARE populated by the scanner.

### Agent (from `src/store/index.ts`)

```typescript
export interface Agent {
  id: number
  name: string
  role: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  // ... more fields
}
```

Agent status is the reactive field for all status badge rendering.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent status reactivity | Custom polling or SSE listener in chat components | Subscribe to `useMissionControl((s) => s.agents)` | `useServerEvents` already handles `agent.status_changed` and updates store |
| Mobile sidebar toggle | New mobile state | Reuse existing `showConversations` + `isMobile` + `handleBackToList` in ChatWorkspace | Pattern already implemented and tested |
| Message sending | New fetch call | Extend existing `handleSend` in ChatWorkspace with dept/team agent resolution | Handles optimistic updates, retry, abort |
| Timestamp formatting | Custom date formatter | Reuse `timeAgo` from `conversation-list.tsx` (or copy pattern) | Already covers `now`, minutes, hours, days |
| Status dot animation | Custom CSS animation | Use existing `pulse-dot` CSS class from `globals.css` | Already defined; no new CSS needed |
| Conversation loading | New API endpoint | Reuse existing `/api/chat/messages?conversation_id=dept:3` | API accepts any string conversation_id |

---

## Common Pitfalls

### Pitfall 1: `manager_agent_id` Not Populated

**What goes wrong:** Department space shows all items as disabled "No lead assigned" even with a full org structure loaded.
**Why it happens:** `org-scanner.ts` does not write `manager_agent_id` into the departments table. The field is only in the TypeScript type, not the DB upsert query. Only manually created departments via the departments-panel API would have this set.
**How to avoid:** The plan must treat this as expected behavior for Phase 1. Departments without `manager_agent_id` show as disabled. Consider including a note in the plan that lead assignment is a separate concern.
**Warning signs:** Department space renders but all items are greyed out.

### Pitfall 2: Sidebar Width Mismatch

**What goes wrong:** Conversation list sidebar renders at `w-56` instead of `w-72`, appearing too narrow.
**Why it happens:** The existing `ChatWorkspace` code uses `w-56` for the sidebar div. The spec requires `w-72` (matching `EntityListSidebar`).
**How to avoid:** Change `w-56` to `w-72` in the sidebar div when wiring in the space selector.
**Warning signs:** Visual regression in the conversation list width.

### Pitfall 3: `pulse-dot` vs `animate-pulse`

**What goes wrong:** Busy dot uses Tailwind's built-in `animate-pulse` (opacity fade) instead of the custom `pulse-dot` animation (scale + opacity).
**Why it happens:** CONTEXT.md mentions `animate-pulse-dot` which sounds like a Tailwind `animate-` class. The actual implementation is a CSS class `pulse-dot` in `globals.css`.
**How to avoid:** Use `className="pulse-dot"` (not `animate-pulse-dot` or `animate-pulse`).

### Pitfall 4: STATUS_COLORS Inversion in ConversationList

**What goes wrong:** The existing `conversation-list.tsx` has `busy: 'bg-green-500'` and `idle: 'bg-yellow-500'` — inverted from the spec and `StatusDot`.
**Why it happens:** Pre-existing bug.
**How to avoid:** The new `AgentStatusBadge` must use the correct spec colors (`idle=green`, `busy=yellow`). Do not copy the STATUS_COLORS map from `conversation-list.tsx`. This bug is pre-existing and fixing it is out of scope for Phase 1 unless explicitly decided otherwise.

### Pitfall 5: `agentTeamAssignments` team_id Field Name

**What goes wrong:** Lookup for team leads fails — `agentTeamAssignments` uses `team_id` in the type but the database uses `team_external_id`.
**Why it happens:** The TypeScript `AgentTeamAssignment` interface uses `team_id: number` while the DB schema column is `team_external_id`. The store hydrates this correctly (the scanner sets `team_id` to the team's `id` which equals `external_id`). In components, always use the store data through `useMissionControl((s) => s.agentTeamAssignments)` — never query the DB directly from a component.
**How to avoid:** Use `a.team_id === teamId` in component logic (store-level field name).

### Pitfall 6: `dept:` Prefix in `loadMessages` / `canSendMessage`

**What goes wrong:** Messages don't load for dept/team conversations, or the send button is unexpectedly disabled.
**Why it happens:** `ChatWorkspace` has `activeConversation.startsWith('session:')` checks that gate message loading and send availability. The `dept:` and `team:` prefixes don't start with `session:`, so they pass the gates correctly. However, `canSendMessage` is `!!activeConversation && !activeConversation.startsWith('session:')` — this is correct as-is for dept/team IDs.
**How to avoid:** Verify the existing guards after wiring — they should work without modification.

### Pitfall 7: Focus Management After Space Switch

**What goes wrong:** After switching spaces, keyboard users cannot navigate the conversation list without clicking first.
**Why it happens:** React does not automatically shift focus on state changes.
**How to avoid:** Use a `useEffect` keyed on `activeChatSpace` to call `.focus()` on the first conversation list item's container element after render.

---

## Code Examples

### getDepartmentChatEntities utility

```typescript
// Location: src/lib/chat-space-utils.ts
import type { Department, Team, Agent, AgentTeamAssignment } from '@/store'

export interface DepartmentChatEntity {
  conversationId: string   // `dept:${dept.id}`
  departmentId: number
  name: string
  color?: string
  leadAgent: Agent | null
  leadAgentId: number | null
}

export function getDepartmentChatEntities(
  departments: Department[],
  agents: Agent[]
): DepartmentChatEntity[] {
  return departments.map((dept) => {
    const leadAgent = dept.manager_agent_id
      ? (agents.find((a) => a.id === dept.manager_agent_id) ?? null)
      : null
    return {
      conversationId: `dept:${dept.id}`,
      departmentId: dept.id,
      name: dept.name,
      color: dept.color,
      leadAgent,
      leadAgentId: dept.manager_agent_id ?? null,
    }
  })
}

export interface TeamChatEntity {
  conversationId: string   // `team:${team.id}`
  teamId: number
  name: string
  color?: string
  departmentName: string | undefined
  leadAgent: Agent | null
}

export function getTeamChatEntities(
  teams: Team[],
  departments: Department[],
  assignments: AgentTeamAssignment[],
  agents: Agent[]
): TeamChatEntity[] {
  return teams.map((team) => {
    const leadAssignment = assignments.find(
      (a) => a.team_id === team.id && a.role === 'lead'
    )
    const leadAgent = leadAssignment
      ? (agents.find((a) => a.id === leadAssignment.agent_id) ?? null)
      : null
    const dept = departments.find((d) => d.id === team.department_id)
    return {
      conversationId: `team:${team.id}`,
      teamId: team.id,
      name: team.name,
      color: team.color,
      departmentName: dept?.name,
      leadAgent,
    }
  })
}
```

### AgentStatusBadge component skeleton

```typescript
// Location: src/components/ui/agent-status-badge.tsx
// Source: StatusDot pattern from src/components/ui/dnd-org-helpers.tsx + spec
import type { Agent } from '@/store'

interface AgentStatusBadgeProps {
  status: Agent['status']
  variant: 'dot' | 'labeled' | 'labeled-with-queue'
  size?: 'sm' | 'md'
}

const STATUS_CONFIG = {
  idle:    { dot: 'bg-green-500', label: 'Available', labelColor: 'text-green-500' },
  busy:    { dot: 'bg-yellow-500', label: 'Busy',      labelColor: 'text-yellow-500' },
  error:   { dot: 'bg-red-500',   label: 'Error',     labelColor: 'text-red-500' },
  offline: { dot: 'bg-gray-500',  label: 'Offline',   labelColor: 'text-gray-500' },
}

export function AgentStatusBadge({ status, variant, size = 'sm' }: AgentStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline
  const dotSize = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2'
  const isPulsing = status === 'busy'

  if (variant === 'dot') {
    return (
      <span
        className={`inline-block rounded-full ${dotSize} ${config.dot} ${isPulsing ? 'pulse-dot' : ''}`}
        aria-label={`Agent status: ${status}`}
      />
    )
  }
  // labeled and labeled-with-queue variants...
}
```

### Extending handleSend for dept/team agent resolution

```typescript
// Modification to ChatWorkspace handleSend (after existing agent_ check):
const departments = useMissionControl((s) => s.departments)
const agentTeamAssignments = useMissionControl((s) => s.agentTeamAssignments)

// In handleSend:
if (!to && activeConversation.startsWith('dept:')) {
  const deptId = Number(activeConversation.slice(5))
  const dept = departments.find((d) => d.id === deptId)
  if (dept?.manager_agent_id) {
    const agent = agents.find((a) => a.id === dept.manager_agent_id)
    to = agent?.name ?? null
  }
}
if (!to && activeConversation.startsWith('team:')) {
  const teamId = Number(activeConversation.slice(5))
  const lead = agentTeamAssignments.find(
    (a) => a.team_id === teamId && a.role === 'lead'
  )
  if (lead) {
    const agent = agents.find((a) => a.id === lead.agent_id)
    to = agent?.name ?? null
  }
}
```

### System message after sending to busy agent

```typescript
// Add after sending, when agent status is busy:
const addChatMessage = useMissionControl((s) => s.addChatMessage)
// ...after send:
if (agentStatus === 'busy') {
  addChatMessage({
    id: Date.now(),
    conversation_id: activeConversation,
    from_agent: 'system',
    to_agent: null,
    content: `${agentName} is busy. Your message is queued and will be delivered.`,
    message_type: 'status',
    created_at: Math.floor(Date.now() / 1000),
  })
}
```

---

## Environment Availability

Step 2.6: SKIPPED — this phase has no external dependencies beyond the project's existing stack (no new CLI tools, services, or runtimes needed).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom + React Testing Library |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test --run src/lib/__tests__/chat-space-utils.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-CHAT-SPACES | `getDepartmentChatEntities` returns correct entity shape with null lead when no `manager_agent_id` | unit | `pnpm test --run src/lib/__tests__/chat-space-utils.test.ts` | No — Wave 0 |
| REQ-CHAT-SPACES | `getTeamChatEntities` returns correct entity shape, resolves lead from assignments | unit | `pnpm test --run src/lib/__tests__/chat-space-utils.test.ts` | No — Wave 0 |
| REQ-CHAT-SPACES | `getDepartmentChatEntities` handles unknown agent_id gracefully (returns null lead) | unit | `pnpm test --run src/lib/__tests__/chat-space-utils.test.ts` | No — Wave 0 |
| REQ-CHAT-SPACES | `AgentStatusBadge` renders correct color per status | unit | `pnpm test --run src/components/ui/__tests__/agent-status-badge.test.tsx` | No — Wave 0 |
| REQ-CHAT-SPACES | Space selector renders three segments, sets active state | unit | `pnpm test --run src/components/chat/__tests__/chat-space-selector.test.tsx` | No — Wave 0 |
| REQ-CHAT-SPACES | Chat workspace renders conversation list (visual/interaction smoke) | manual | `pnpm dev` + visual verify | — |

### Sampling Rate

- **Per task commit:** `pnpm test --run src/lib/__tests__/chat-space-utils.test.ts`
- **Per wave merge:** `pnpm test`
- **Phase gate:** `pnpm test && pnpm typecheck && pnpm lint` green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/chat-space-utils.test.ts` — covers REQ-CHAT-SPACES utility functions
- [ ] `src/components/ui/__tests__/agent-status-badge.test.tsx` — covers AgentStatusBadge variants
- [ ] `src/components/chat/__tests__/chat-space-selector.test.tsx` — covers segmented control behavior

*(The `src/test/setup.ts` and vitest config already exist — no new framework setup needed)*

---

## Open Questions

1. **`manager_agent_id` population**
   - What we know: The field exists in the store type but `org-scanner.ts` does not write it. Departments from the filesystem will always have `manager_agent_id === undefined`.
   - What's unclear: Is there a mechanism (manual or planned) to set this? Or should Phase 1 instead use `agentTeamAssignments` with a special "department lead" role?
   - Recommendation: For Phase 1, render departments as disabled when `manager_agent_id` is absent (per spec). Document this as an expected state for users who have not yet assigned department leads manually. Do not block the phase on this.

2. **ChatInput placeholder prop**
   - What we know: `ChatInput` currently uses a hardcoded placeholder (or none). The spec requires dynamic placeholders per space/entity.
   - What's unclear: `ChatInput` accepts `agents`, `onSend`, `onAbort`, `disabled`, `isGenerating` — no `placeholder` prop.
   - Recommendation: Add an optional `placeholder?: string` prop to `ChatInput` and pass it to the textarea. This is a minimal change with no side effects.

3. **Conversation record creation for new dept/team conversations**
   - What we know: `loadMessages` fetches from `/api/chat/messages?conversation_id=dept:3`. If no messages exist, it returns an empty array. The `conversations` Zustand array is populated by `ConversationList` polling `/api/sessions` — it will NOT include `dept:3` entries from this endpoint.
   - What's unclear: Should dept/team conversations appear in the existing `ConversationList` (Agents space)? Or are they purely derived from dept/team data?
   - Recommendation: Dept/team conversations are derived entries — they appear in the `SpaceConversationList` without needing a DB `Conversation` record. The `setActiveConversation('dept:3')` call will work because `loadMessages` fetches directly. The `lastMessage` field for these items is derived from `chatMessages` in the store (last message with that `conversation_id`) — NOT from `conversations[].lastMessage`.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `src/store/index.ts`, `src/components/chat/chat-workspace.tsx`, `src/components/chat/conversation-list.tsx`, `src/components/chat/chat-input.tsx`, `src/components/ui/dnd-org-helpers.tsx`, `src/lib/use-server-events.ts`, `src/lib/org-scanner.ts`, `src/lib/use-org-data.ts`, `src/lib/schema.sql`, `src/app/globals.css`
- `.planning/UI-SPEC-chat-spaces.md` — approved visual/interaction specification
- `.planning/phases/01-agent-chat-spaces-ui/01-CONTEXT.md` — locked implementation decisions

### Secondary (MEDIUM confidence)

- `src/components/panels/departments-panel.tsx` — EmptyState pattern, existing Zustand selector patterns

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire codebase inspected, no new packages needed
- Architecture patterns: HIGH — direct code reading of integration points
- Pitfalls: HIGH — identified from actual code (status color inversion, manager_agent_id gap, pulse-dot naming)
- Open questions: MEDIUM — two require implementation decisions, one is a known constraint

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable codebase, no fast-moving dependencies)
