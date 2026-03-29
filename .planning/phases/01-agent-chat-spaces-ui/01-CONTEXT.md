# Phase 1: Agent Chat Spaces UI - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/UI-SPEC-chat-spaces.md)

<domain>
## Phase Boundary

This phase adds an embedded chat interface as a new tab inside the existing Departments panel and Teams panel. Messages route to the lead agent of the department/team, who delegates to other agents via their prompt. A reusable `EmbeddedChat` component handles message loading, sending, optimistic updates, and status system messages. An `AgentStatusBadge` component provides labeled status display in the chat header.

</domain>

<decisions>
## Implementation Decisions

### Embedded Chat Component
- New reusable component: `src/components/chat/embedded-chat.tsx`
- Props: `conversationId`, `targetAgentName`, `targetAgentStatus`, `entityLabel`, `entityColor`
- Handles message loading from `/api/chat/messages?conversation_id=X`
- Sends via `POST /api/chat/messages` with `to: targetAgentName`
- Manages optimistic updates with negative temp IDs (same pattern as ChatWorkspace)
- Polls for new messages using `useSmartPoll` (existing hook)
- Auto-scrolls to bottom on new messages
- Reuses existing `MessageList` component for rendering messages
- Reuses existing `ChatInput` component with new `placeholder` prop

### Chat Header (Inline in EmbeddedChat)
- Shows entity label + lead agent name on the left
- Shows `AgentStatusBadge` with `variant: 'labeled-with-queue'` on the right
- Color dot from entity color
- Height: `py-3 px-4`, background: `bg-[hsl(var(--surface-1))]`, border: `border-b border-border/50`

### AgentStatusBadge
- Location: `src/components/ui/agent-status-badge.tsx`
- Three variants: `dot` (8px circle), `labeled` (dot + text), `labeled-with-queue` (dot + text + queue hint)
- Sizes: `sm` (default), `md`
- Colors: idle=green-500 "Available", busy=yellow-500 "Busy", error=red-500 "Error", offline=gray-500 "Offline"
- Busy dot: `pulse-dot` CSS class (not Tailwind `animate-pulse`)
- Queue hint: `text-[10px] font-mono text-muted-foreground/50` "Busy -- messages will queue"

### Department Panel Integration
- Add `'chat'` to `DeptTab = 'overview' | 'teams' | 'agents' | 'docs' | 'chat'`
- Add `'chat'` to the `viewTabs` array
- When `tab === 'chat'`: resolve lead agent from `dept.manager_agent_id`, render `<EmbeddedChat>` or empty state
- Empty state when no `manager_agent_id`: "No lead assigned. Assign a department lead to enable chat."

### Team Panel Integration
- Add `'chat'` to `TeamView = 'overview' | 'members' | 'docs' | 'chat'`
- Add `'chat'` to the tab bar array
- When `view === 'chat'` (inside TeamDetail): resolve lead from `agentTeamAssignments.find(a => a.team_id === team.id && a.role === 'lead')`, render `<EmbeddedChat>` or empty state
- Empty state when no lead: "No team lead assigned. Promote an agent to lead to enable chat."

### Conversation ID Format
- Department: `dept:<department_id>` (e.g., `dept:3`)
- Team: `team:<team_id>` (e.g., `team:7`)
- Agent: `agent_<name>` (existing, unchanged)

### Message Sending to Busy/Offline/Error Agents
- Send button NEVER disabled due to agent status (only disabled for empty input or in-flight request)
- After sending to busy: system message "[Name] is busy. Your message is queued and will be delivered."
- After sending to offline: "[Name] is offline. Your message will be delivered when available."
- After sending to error: "[Name] is in an error state. Your message was sent but response may be delayed."
- System messages: styled `text-xs font-mono text-muted-foreground/50 text-center py-1`, `role="status"`

### ChatInput Placeholder Prop
- Add optional `placeholder?: string` prop to `ChatInput` component
- Department chat: "Message {dept name} department..."
- Team chat: "Message {team name} team..."

### No Zustand Store Changes
- No new store fields needed. EmbeddedChat manages its own message state locally.
- Lead agent resolution is computed inline in the panel components.

### Claude's Discretion
- Internal component decomposition within EmbeddedChat
- Whether to extract the chat header as a separate component or keep inline
- Exact scroll-to-bottom implementation
- Testing approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI Specification
- `.planning/UI-SPEC-chat-spaces.md` -- Full visual/interaction spec for embedded chat

### Existing Chat Infrastructure
- `src/components/chat/chat-workspace.tsx` -- Reference for message send pattern (handleSend), optimistic updates, polling
- `src/components/chat/chat-input.tsx` -- ChatInput component (needs placeholder prop)
- `src/components/chat/message-list.tsx` -- MessageList component (reuse as-is)
- `src/components/chat/message-bubble.tsx` -- MessageBubble component (reuse as-is)

### Panel Integration Points
- `src/components/panels/departments-panel.tsx` -- DepartmentDetail component, DeptTab type, viewTabs array
- `src/components/panels/teams-panel.tsx` -- TeamDetail component, TeamView type, tab bar

### Entity Data
- `src/store/index.ts` -- Department, Team, Agent, AgentTeamAssignment types; store selectors

### CSS
- `src/app/globals.css` -- `pulse-dot` CSS class for busy animation

</canonical_refs>

<specifics>
## Specific Ideas

- EmbeddedChat is completely self-contained: it loads its own messages, manages its own send state, and does not touch the global `activeConversation` or `chatMessages` store fields
- Department/team conversations only store chat messages (source: 'chat'), not session transcripts
- The chat tab is always visible in the tab bar, even when no lead is assigned (shows empty state)
- Color dots for departments/teams use entity `color` field, NOT the theme accent

</specifics>

<deferred>
## Deferred Ideas

- Group chat (multiple agents in one conversation)
- Agent-to-agent conversation viewing
- Voice/audio interfaces
- Real-time typing indicators
- Unread message counts on the chat tab badge
- Delegation visibility (showing which sub-agent is responding)

</deferred>

---

*Phase: 01-agent-chat-spaces-ui*
*Context gathered: 2026-03-30 via PRD Express Path*
