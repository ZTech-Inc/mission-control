# Phase 1: Agent Chat Spaces UI - Research

**Researched:** 2026-03-30
**Domain:** React/Next.js UI, embedded chat widget, panel tab extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Embedded Chat Component:**
- New reusable component at `src/components/chat/embedded-chat.tsx`
- Props: `conversationId`, `targetAgentName`, `targetAgentStatus`, `entityLabel`, `entityColor`
- Self-contained: loads own messages, manages own send state
- Does NOT touch global `activeConversation` or `chatMessages` store fields
- Reuses existing `MessageList` and `ChatInput` components
- Chat header inline: entity label + lead name on left, AgentStatusBadge on right
- Header styling: `py-3 px-4`, `bg-[hsl(var(--surface-1))]`, `border-b border-border/50`

**AgentStatusBadge:**
- Location: `src/components/ui/agent-status-badge.tsx`
- Three variants: `dot` (8px), `labeled` (dot + text), `labeled-with-queue` (dot + text + queue hint)
- idle=green-500, busy=yellow-500, error=red-500, offline=gray-500
- Busy dot: `pulse-dot` CSS class from globals.css
- Queue hint: `text-[10px] font-mono text-muted-foreground/50`

**Department Panel Integration:**
- Add `'chat'` to `DeptTab` type and `viewTabs` array
- Resolve lead from `dept.manager_agent_id`
- Render `<EmbeddedChat>` when tab is 'chat' and lead exists
- Empty state when no lead assigned

**Team Panel Integration:**
- Add `'chat'` to `TeamView` type and tab bar
- Resolve lead from `agentTeamAssignments` with `role === 'lead'`
- Render `<EmbeddedChat>` when view is 'chat' and lead exists
- Empty state when no lead assigned

**Message Sending:**
- Send button NEVER disabled due to agent status
- System messages after sending to busy/offline/error agents
- Styled `text-xs font-mono text-muted-foreground/50 text-center py-1`, `role="status"`

**ChatInput Placeholder:**
- Add `placeholder?: string` prop to existing ChatInput
- Department: "Message {dept name} department..."
- Team: "Message {team name} team..."

**No Zustand Store Changes.**

### Claude's Discretion
- Internal component decomposition within EmbeddedChat
- Whether to extract the chat header as a separate component
- Exact scroll-to-bottom implementation
- Testing approach

### Deferred Ideas (OUT OF SCOPE)
- Group chat
- Agent-to-agent conversation viewing
- Voice/audio interfaces
- Typing indicators
- Unread counts on tab badge
- Delegation visibility
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-EMBEDDED-CHAT | Reusable EmbeddedChat component with message loading, sending, optimistic updates, status messages, and auto-scroll | Full coverage: message API, send pattern, polling, MessageList/ChatInput reuse all researched |
| REQ-DEPT-CHAT-TAB | Chat tab in departments-panel with lead agent resolution and empty state | Full coverage: DeptTab type, viewTabs array, manager_agent_id field all identified |
| REQ-TEAM-CHAT-TAB | Chat tab in teams-panel with lead agent resolution and empty state | Full coverage: TeamView type, tab bar, agentTeamAssignments lead resolution all identified |
| REQ-STATUS-BADGE | AgentStatusBadge component with dot/labeled/labeled-with-queue variants | Full coverage: StatusDot pattern, pulse-dot CSS class, color mapping all identified |
</phase_requirements>

---

## Summary

Phase 1 adds embedded chat as a tab in the Departments and Teams panels. The primary work is: (1) creating a self-contained `EmbeddedChat` component that reuses existing `MessageList` and `ChatInput`, (2) creating an `AgentStatusBadge` component, (3) adding a 'chat' tab to `departments-panel.tsx`, and (4) adding a 'chat' tab to `teams-panel.tsx`.

The `EmbeddedChat` component mirrors the message-handling logic from `ChatWorkspace.handleSend` but operates independently — it manages its own message array locally, sends to `/api/chat/messages`, and polls for updates. This avoids coupling with the global chat state.

**Critical finding:** `manager_agent_id` on departments is NOT populated by the filesystem org scanner. Most departments will show the "No lead assigned" empty state unless leads are assigned manually. This is expected behavior for Phase 1.

**Team leads ARE populated** by the scanner from `AGENT.md` metadata (`role: 'lead'` in `agentTeamAssignments`). Team chat will work for teams with assigned leads.

---

## Standard Stack

No new packages needed. All dependencies are already installed.

| Library | Version | Purpose |
|---------|---------|---------|
| Next.js | 16 | App Router |
| React | 19 | UI rendering |
| TypeScript | 5 | Type safety |
| Zustand | (installed) | Store selectors for agents, departments, teams |
| Tailwind CSS | 3 | Styling |

---

## Architecture Patterns

### File Layout

```
src/
├── components/
│   ├── chat/
│   │   ├── embedded-chat.tsx         # NEW: reusable embedded chat widget
│   │   ├── chat-input.tsx            # MODIFY: add placeholder prop
│   │   ├── message-list.tsx          # UNCHANGED (reused by EmbeddedChat)
│   │   ├── message-bubble.tsx        # UNCHANGED (reused via MessageList)
│   │   └── chat-workspace.tsx        # UNCHANGED
│   ├── panels/
│   │   ├── departments-panel.tsx     # MODIFY: add 'chat' tab
│   │   └── teams-panel.tsx           # MODIFY: add 'chat' tab
│   └── ui/
│       └── agent-status-badge.tsx    # NEW: status badge component
```

### Pattern 1: Message Send (from ChatWorkspace)

The `handleSend` function in `ChatWorkspace` (lines 131-189) follows this pattern:
1. Parse mention from content
2. Resolve target agent name from conversation ID
3. Create optimistic message with negative temp ID
4. Add to message list
5. POST to `/api/chat/messages`
6. On success: replace pending message with server response
7. On failure: mark message as failed

`EmbeddedChat` replicates this pattern but with local state instead of global store.

### Pattern 2: Message Loading (from ChatWorkspace)

`loadMessages` (lines 89-104) fetches from `/api/chat/messages?conversation_id=X&limit=100`. The API accepts any string conversation_id, so `dept:3` and `team:7` work without API changes.

### Pattern 3: Polling (from ChatWorkspace)

`useSmartPoll(loadMessages, 15000, { enabled, pauseWhenSseConnected: true })` — polls every 15s, pauses when SSE is connected. EmbeddedChat should use the same pattern.

### Pattern 4: EmptyState (from departments-panel)

```typescript
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

### Pattern 5: StatusDot (existing)

`StatusDot` in `dnd-org-helpers.tsx` maps: idle→green-500, busy→yellow-500, error→red-500, offline→gray-500. `AgentStatusBadge` extends this with labeled variants.

### Pattern 6: pulse-dot CSS Class

Defined in `src/app/globals.css`:
```css
.pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
@keyframes pulse-dot { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.7; } }
```
Use `className="pulse-dot"` on busy status dots. NOT Tailwind's `animate-pulse`.

### Pattern 7: Department Tab System

`DepartmentDetail` uses `const [tab, setTab] = useState<DeptTab>('overview')` with `viewTabs: DeptTab[] = ['overview', 'teams', 'agents', 'docs']`. Tabs render in a header bar with conditional content below. Adding 'chat' follows this exactly.

### Pattern 8: Team Tab System

`TeamsPanel` uses `const [activeView, setActiveView] = useState<TeamView>('overview')` with tabs rendered in the top bar. `TeamDetail` receives `view` as a prop. Adding 'chat' requires updating both `TeamView` type and the tab bar render, plus handling `view === 'chat'` in `TeamDetail`.

### Anti-Patterns to Avoid

- **Storing EmbeddedChat messages in global Zustand:** Use local state. The global `chatMessages` array is for ChatWorkspace's active conversation only.
- **Modifying ChatWorkspace:** ChatWorkspace is unchanged. Individual agent chat stays exactly as-is.
- **Using `animate-pulse`:** Use the `pulse-dot` CSS class, not Tailwind's `animate-pulse`.
- **Hiding chat tab when no lead:** Always show the tab; render empty state inside.

---

## Data Model: Key Findings

### Department Lead Resolution

```typescript
// dept.manager_agent_id is optional and NOT populated by filesystem scanner
const leadAgent = dept.manager_agent_id
  ? agents.find(a => a.id === dept.manager_agent_id) ?? null
  : null
```

**Most departments from filesystem scan will have `manager_agent_id === undefined`.** The chat tab shows "No lead assigned" empty state.

### Team Lead Resolution

```typescript
// Team leads come from agentTeamAssignments (populated by filesystem scanner)
const leadAssignment = agentTeamAssignments.find(
  a => a.team_id === team.id && a.role === 'lead'
)
const leadAgent = leadAssignment
  ? agents.find(a => a.id === leadAssignment.agent_id) ?? null
  : null
```

Team leads ARE populated by the scanner from `AGENT.md` metadata. Team chat is more likely to work out-of-the-box.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Message rendering | Custom message display | Reuse `MessageList` + `MessageBubble` from `src/components/chat/` |
| Chat input | New textarea + send | Reuse `ChatInput` with new `placeholder` prop |
| Polling | Custom setInterval | Use existing `useSmartPoll` hook |
| Agent status reactivity | Custom polling | Subscribe to `useMissionControl((s) => s.agents)` |
| Status dot animation | Custom CSS | Use existing `pulse-dot` CSS class from globals.css |

---

## Common Pitfalls

### Pitfall 1: `manager_agent_id` Not Populated
**What goes wrong:** Department chat tab always shows "No lead assigned" even with full org structure.
**Why:** `org-scanner.ts` does not write `manager_agent_id`. Only manual assignment sets it.
**How to avoid:** Expected behavior for Phase 1. Show empty state gracefully.

### Pitfall 2: `pulse-dot` vs `animate-pulse`
**What goes wrong:** Busy dot uses wrong animation.
**How to avoid:** Use `className="pulse-dot"` (CSS class from globals.css).

### Pitfall 3: STATUS_COLORS Inversion in ConversationList
**What goes wrong:** Existing `conversation-list.tsx` has `busy: 'bg-green-500'` and `idle: 'bg-yellow-500'` — inverted.
**How to avoid:** AgentStatusBadge uses correct mapping. Don't copy from conversation-list.tsx.

### Pitfall 4: Global vs Local Message State
**What goes wrong:** EmbeddedChat writes to global `chatMessages` store, conflicting with ChatWorkspace.
**How to avoid:** EmbeddedChat manages its own `useState<ChatMessage[]>` for messages.

### Pitfall 5: ChatInput Already Has State in Store
**What goes wrong:** Multiple EmbeddedChat instances share `chatInput` store field.
**How to avoid:** Either scope the store field per conversation or use local state in EmbeddedChat for input text. Simplest: EmbeddedChat wraps ChatInput and manages input locally. May need to check if ChatInput's internal use of `useMissionControl((s) => s.chatInput)` conflicts.

### Pitfall 6: MessageList Depends on Global Store
**What goes wrong:** `MessageList` reads from `useMissionControl((s) => s.chatMessages)`, which may not contain EmbeddedChat's messages.
**How to avoid:** Check MessageList's implementation. If it reads from the global store, EmbeddedChat may need to either: (a) temporarily populate `chatMessages` while visible, or (b) render messages directly without MessageList. Investigate during implementation.

---

## Open Questions

1. **MessageList Global Store Dependency**
   - Does `MessageList` read from `useMissionControl((s) => s.chatMessages)` or accept messages as props?
   - If from store: EmbeddedChat must either populate the global store or render messages itself.
   - Recommendation: Check during implementation. If MessageList reads from store, the simplest approach is to set `chatMessages` in the store scoped by conversation ID, or render messages inline.

2. **ChatInput Global Store Dependency**
   - `ChatInput` uses `useMissionControl((s) => s.chatInput)` for textarea value.
   - Multiple EmbeddedChat instances would share the same input state.
   - Recommendation: For Phase 1, only one EmbeddedChat is visible at a time (user can only view one department/team detail). The global `chatInput` state will work since only one input is active. If this becomes an issue, scope later.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom + React Testing Library |
| Config | `vitest.config.ts` |
| Quick run | `pnpm test --run <file>` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | File |
|--------|----------|-----------|------|
| REQ-STATUS-BADGE | AgentStatusBadge renders correct color per status | unit | `src/components/ui/__tests__/agent-status-badge.test.tsx` |
| REQ-STATUS-BADGE | Busy dot uses pulse-dot class | unit | same |
| REQ-STATUS-BADGE | Queue hint only shows for busy + labeled-with-queue | unit | same |
| REQ-EMBEDDED-CHAT | System message text for each status | unit | `src/components/chat/__tests__/embedded-chat.test.ts` |
| REQ-DEPT-CHAT-TAB | Visual/integration | manual | `pnpm dev` |
| REQ-TEAM-CHAT-TAB | Visual/integration | manual | `pnpm dev` |

### Phase Gate

`pnpm test && pnpm typecheck && pnpm lint` green before `/gsd:verify-work`

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection: `src/components/chat/chat-workspace.tsx` (handleSend, loadMessages, useSmartPoll), `src/components/chat/chat-input.tsx`, `src/components/chat/message-list.tsx`, `src/components/panels/departments-panel.tsx`, `src/components/panels/teams-panel.tsx`, `src/store/index.ts`, `src/app/globals.css`
- `.planning/UI-SPEC-chat-spaces.md` — approved specification

---

## Metadata

**Confidence:** HIGH — all integration points directly inspected in codebase.
**Research date:** 2026-03-30
**Valid until:** 2026-04-30
