# Phase 2: Add Way to Promote Agents to Team Lead - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds API-backed persistence for promoting/demoting agents to team lead roles and assigning department leads. It enhances the existing store-only promotion UX with confirmation flows, visual feedback, and proper API persistence to SQLite. Both team lead promotion and department lead assignment are in scope — both are required to fully enable the lead-aware chat routing established in Phase 1.

</domain>

<decisions>
## Implementation Decisions

### Persistence & API Shape
- **D-01:** New API routes for team assignment role changes: `PATCH /api/teams/:id/assignments` to update an agent's role within a team
- **D-02:** New API route for department lead assignment: `PUT /api/departments/:id/lead` to set `manager_agent_id`
- **D-03:** Zustand actions should call API first, then update local state on success (optimistic update with rollback on failure)
- **D-04:** Existing `agent_team_assignments` table already has `role` column — no schema migration needed for team leads
- **D-05:** Department `manager_agent_id` column does NOT exist in DB schema (confirmed by research — migration 049 DDL omits it). Migration 050 is required to add `ALTER TABLE departments ADD COLUMN manager_agent_id INTEGER`

### Scope — Team Leads + Department Leads
- **D-06:** Both team lead promotion and department lead assignment are in scope for this phase
- **D-07:** Team lead: update `AgentTeamAssignment.role` to 'lead' (existing data model)
- **D-08:** Department lead: set `Department.manager_agent_id` (existing data model)
- **D-09:** Both are required to fully enable embedded chat (Phase 1 shows empty states when no lead is assigned)

### Promotion UX
- **D-10:** Keep existing "promote" inline button in team members list — enhance with brief inline confirmation (not modal)
- **D-11:** Add a department lead selector in the department overview tab (dropdown or agent picker)
- **D-12:** Visual feedback: lead gets a distinct badge/highlight in the member list (reuse Phase 1 AgentStatusBadge patterns)
- **D-13:** Demoting old lead to member happens automatically when a new lead is promoted (existing `handleSetLead` behavior preserved)

### Lead Constraints
- **D-14:** Single lead per team — promoting a new agent automatically demotes the existing lead to member
- **D-15:** An agent can lead multiple teams — no restriction
- **D-16:** Department lead is separate from team lead — same agent can hold both roles
- **D-17:** An agent must be a team member before being promoted to lead (no promoting unassigned agents)

### Chat Routing Impact
- **D-18:** Existing conversation history is preserved when lead changes (conversation ID is tied to entity, not agent)
- **D-19:** New messages in embedded chat route to the newly promoted lead automatically
- **D-20:** No need to migrate, close, or archive conversations when lead changes

### Claude's Discretion
- API error handling patterns (validation, 4xx responses)
- Whether to batch team + department lead operations or keep separate endpoints
- Exact confirmation UX for promotion (tooltip, inline expand, etc.)
- Testing approach and coverage

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Context (Lead-Aware Chat)
- `.planning/phases/01-agent-chat-spaces-ui/01-CONTEXT.md` — Defines embedded chat routing to lead agents, empty states, conversation ID format

### Panel Integration Points
- `src/components/panels/teams-panel.tsx` — TeamDetail component with existing `handleSetLead`, `handleAddMembers`, member list with "promote" button
- `src/components/panels/departments-panel.tsx` — DepartmentDetail component with `manager_agent_id` resolution, empty state for no lead

### Data Layer
- `src/store/index.ts` — Department type (`manager_agent_id`), AgentTeamAssignment type (`role: 'member' | 'lead'`), `assignAgentToTeam` action
- `src/lib/migrations.ts` — `agent_team_assignments` table schema (line ~1451), Department table with `manager_agent_id`
- `src/lib/org-scanner.ts` — Filesystem-based org scanning that populates assignments with `assignmentRole`

### Existing Chat Components
- `src/components/chat/embedded-chat.tsx` — Renders lead agent name, routes messages to `targetAgentName`

### Mock Data (Reference)
- `src/lib/mock-org-data.ts` — Example team assignments with lead roles

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleSetLead` in teams-panel.tsx: Already handles single-lead constraint (demotes old lead, promotes new)
- `assignAgentToTeam` Zustand action: Already accepts `role: 'member' | 'lead'` parameter
- `AgentMultiSelect` component: Reusable for department lead selector
- `AgentStatusBadge`: Can extend for lead indicator badge
- Auth guard pattern (`requireRole`): Reuse for new API routes

### Established Patterns
- API routes: `src/app/api/<feature>/route.ts` with auth guards, validation via `validateBody`
- Store actions: Call API → update local state (see existing agent/task API patterns)
- Role types: Literal union `'member' | 'lead'` already established
- Org data hook: `useOrgData()` already loads org structure including assignments

### Integration Points
- Teams panel members tab: Existing "promote" button at line ~302-309
- Department panel overview: Currently shows lead info but no assignment UI
- Embedded chat: Resolves lead from assignments/manager_agent_id — will automatically pick up changes
- Org scanner: Populates assignments from filesystem — API changes should not conflict with filesystem source

</code_context>

<specifics>
## Specific Ideas

- The existing promote button works but is store-only — this phase makes it persistent
- Department lead selector should feel consistent with the team lead promotion UX
- The org-scanner writes assignments with `source: 'filesystem'` — API-created assignments should use `source: 'manual'` or `source: 'api'` to distinguish
- When org-scanner re-runs, filesystem assignments should not override manually promoted leads (need to handle source priority)

</specifics>

<deferred>
## Deferred Ideas

- Bulk role assignment (promoting multiple agents at once)
- Lead rotation scheduling
- Lead assignment history/audit trail
- Notification when lead changes (notify team members)
- Permission-based lead assignment (only admins can promote)
- Cross-department lead visibility

</deferred>

---

*Phase: 02-add-way-to-promote-agents-to-team-lead*
*Context gathered: 2026-03-30*
