# Phase 1: Agent Chat Spaces UI - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/UI-SPEC-chat-spaces.md)

<domain>
## Phase Boundary

This phase delivers three chat space contexts (Departments, Teams, Agents) within the existing ChatWorkspace. It adds a space selector, space-specific conversation lists, context headers with status badges, and Zustand state to manage active spaces. Messages to busy/offline/error agents are never blocked — they queue with system message feedback.

</domain>

<decisions>
## Implementation Decisions

### Space Selector
- Segmented control with three segments: Departments, Teams, Agents
- Container: `bg-[hsl(var(--surface-1))] rounded-md p-1` inside sidebar header
- Each segment: `px-3 py-2 text-xs font-mono uppercase tracking-wider`
- Active: `bg-[hsl(var(--surface-2))] text-foreground rounded`
- Inactive: `text-muted-foreground hover:text-foreground`
- Count badges: `text-[10px] font-mono tabular-nums ml-1 text-muted-foreground/50`
- Text labels only, no icons/emoji
- ARIA: `role="tablist"` container, `role="tab"` segments, arrow key navigation

### Conversation List (SpaceConversationList)
- Replaces/wraps ConversationList when a chat space is active
- Department items: color dot (10px) + dept name + lead agent name + status dot (8px) + last message preview + timestamp
- Team items: color dot (10px) + team name + parent dept breadcrumb + lead agent name + status dot (8px) + preview + timestamp
- Agent items: agent name + role + status dot (8px) + preview + timestamp; grouped into Online (busy first, then idle, then error) and Offline sections
- Selected state: `bg-surface-1 border-l-2 border-primary`
- Hover state: `bg-surface-1/50`
- Item padding: `px-3 py-2`, separator: `border-b border-border/30`
- Departments without `manager_agent_id`: disabled, `opacity-50`, "No lead assigned"
- Teams without lead: disabled similarly
- ARIA: `role="listbox"` container, `role="option"` items, arrow up/down navigation

### Context Header (ChatContextHeader)
- Height 56px (`py-3 px-4`), `bg-[hsl(var(--surface-0))]`, `border-b border-border/50`
- Left: entity name (`text-base font-semibold font-mono`) + breadcrumb/lead info (`text-xs font-mono text-muted-foreground`)
- Right: AgentStatusBadge with labeled or labeled-with-queue variant
- Department: `[color dot] Dept Name` / `Lead: AgentName`
- Team: `[color dot] Team Name` / `DeptName > Lead: AgentName`
- Agent: `[status dot] AgentName` / `Role`
- Long names: `truncate` with `max-w-[300px]` on name, `max-w-[200px]` on breadcrumb

### Agent Status Badge (AgentStatusBadge)
- Three variants: `dot` (8px circle), `labeled` (dot + text), `labeled-with-queue` (dot + text + queue hint)
- Sizes: `sm` (default), `md`
- Colors: idle=green-500 "Available", busy=yellow-500 "Busy", error=red-500 "Error", offline=gray-500 "Offline"
- Busy dot: `animate-pulse-dot` animation
- Queue hint: `text-[10px] font-mono text-muted-foreground/50` "Busy -- messages will queue"

### Conversation ID Format
- Department: `dept:<department_id>` (e.g., `dept:3`)
- Team: `team:<team_id>` (e.g., `team:7`)
- Agent: `agent_<name>` (existing, unchanged)

### State Management (Zustand)
- New fields in `useMissionControl`: `activeChatSpace: 'departments' | 'teams' | 'agents'`, `lastConversationBySpace: Record<string, string | null>`
- New action: `setActiveChatSpace`
- Default: `activeChatSpace: 'agents'` (preserves existing behavior)
- Derived data computed in components, not stored: `getDepartmentChatEntities()`, `getTeamChatEntities()`
- Utility functions in new file `src/lib/chat-space-utils.ts`

### Message Sending to Busy/Offline/Error Agents
- Send button NEVER disabled due to agent status (only disabled for empty input or in-flight request)
- After sending to busy: system message "[Name] is busy. Your message is queued and will be delivered."
- After sending to offline: "[Name] is offline. Your message will be delivered when available."
- After sending to error: "[Name] is in an error state. Your message was sent but response may be delayed."
- System messages: `type: 'status'`, styled `text-xs font-mono text-muted-foreground/50 text-center py-1`, `role="status"`

### Space Switching Behavior
- Synchronous (local state only), no loading spinners
- Previous conversation preserved in store but message area shows empty state until conversation selected in new space
- Last selected conversation per space remembered in `lastConversationBySpace`
- On switch: focus moves to first conversation in new list
- On conversation select: focus moves to chat input

### Chat Input Placeholders
- Department: "Message {dept name} department..."
- Team: "Message {team name} team..."
- Agent: "Message {agent name}..." (existing)

### Empty States
- Match existing `EmptyState` pattern: `text-muted-foreground/30, centered, text-4xl "/" icon, text-sm title, text-xs subtitle`
- No conversation selected: "/" + "Select a conversation to begin"
- No dept leads: "/" + "No department leads assigned"
- No depts exist: "/" + "Create departments in the Departments panel"
- No team leads: "/" + "No team leads assigned"
- No teams exist: "/" + "Create teams in the Teams panel"
- No agents: "/" + "No agents registered"
- Conversation with no messages: "/" + "Start a conversation with [Entity Name]"

### Real-Time Updates
- SSE `agent.status_changed` events update agent status in Zustand store
- All AgentStatusBadge components reactively update
- Conversation list status dots update in real time
- Queue hint disappears when busy agent becomes idle

### Unread Indicator
- Small dot `w-1.5 h-1.5 rounded-full bg-primary` on conversation list items with unread messages

### Layout
- Desktop (>=768px): left sidebar `w-72` (matches EntityListSidebar), right pane `flex-1 min-w-0`
- Mobile (<768px): horizontal scroll strip for space selector, conversation list fills viewport, selecting conversation replaces list, back button returns
- Space selector: full-width inside sidebar, 36px height

### Claude's Discretion
- Internal component decomposition within the specified components
- File organization for shared utilities
- Exact implementation of the mobile back button
- Scroll restoration strategy within message area
- How to integrate with existing ConversationList component (wrap vs replace)
- Testing approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI Specification
- `.planning/UI-SPEC-chat-spaces.md` -- Full visual/interaction spec for all chat space components

### Existing Chat Infrastructure
- `src/components/chat/` -- Existing ChatWorkspace, ChatInput, MessageBubble, ConversationList components
- `src/store/index.ts` -- Zustand store with existing chat state (activeConversation, conversations, etc.)

### Entity Data
- `src/components/panels/departments-panel.tsx` -- Department panel patterns, EmptyState pattern
- `src/components/panels/teams-panel.tsx` -- Team panel patterns
- `src/lib/use-org-data.ts` -- Org data hook (departments, teams, agents)

### Database/Schema
- `src/lib/schema.sql` -- Database schema for departments, teams, agents, agent_team_assignments

</canonical_refs>

<specifics>
## Specific Ideas

- Space selector sits above conversation list in left sidebar
- Department/team conversations only show chat conversations (source: 'chat'), not session transcripts
- If a department/team references an agent ID that no longer exists: render as "Unknown Agent", status offline
- Agent comes online system message: "[Name] is now available." (only if conversation is active)
- Color dots for departments/teams use entity `color` field, NOT the overall theme accent

</specifics>

<deferred>
## Deferred Ideas

- Group chat (multiple agents in one conversation)
- Agent-to-agent conversation viewing
- Voice/audio interfaces
- URL routing changes for chat spaces
- Scroll position preservation across conversation switches

</deferred>

---

*Phase: 01-agent-chat-spaces-ui*
*Context gathered: 2026-03-30 via PRD Express Path*
