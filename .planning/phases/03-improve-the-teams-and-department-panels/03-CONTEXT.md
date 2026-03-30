# Phase 3: Improve the Teams and Department Panels - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase improves the Teams and Department panels with working creation buttons, a rich inline agent details card (replacing team notes), chat history with agent selection, filesystem-backed doc creation, and a full department lead→manager terminology rename. Both panels get polished button prominence, fixed separators, and functional modals for creating new agents, teams, and departments.

</domain>

<decisions>
## Implementation Decisions

### Teams Panel — Overview Tab
- **D-01:** Replace the team notes card with an agent details card that takes 2/3 of the screen width. The Team Roster card becomes smaller (1/3 width).
- **D-02:** The agent details card reuses the same tab structure as `AgentDetailModalPhase3` but renders tabs as vertical sidebar tabs on the left side of the card (not horizontal). All 11 tabs: Overview, Files, Tools, Models, Channels, Cron, SOUL, Memory, Tasks, Activity, Config.
- **D-03:** Default: pre-load the team lead's details with the lead visually highlighted/selected in the roster. If no team lead is assigned, show an empty state prompting to select an agent.
- **D-04:** Clicking any agent in the roster updates the agent details card to show that agent's information. The selected agent must be visually highlighted in the roster.
- **D-05:** Keep the overall aesthetic of the Teams panel consistent.

### Teams Panel — New Team Button
- **D-06:** The "New Team" button must be visually prominent (Claude's discretion on exact style — fits dark panel aesthetic).
- **D-07:** Clicking it creates a new directory in `ZTech_Agents/<department>/<TEAM_NAME>/` AND a database record. The read-only constraint on ZTech_Agents is removed for creation operations.

### Teams Panel — Members Tab
- **D-08:** Fix the "Add Member" button to open a modal for creating a NEW agent (not selecting existing ones).
- **D-09:** The agent creation form includes: name, role, model, editable text areas for IDENTITY.md / AGENT.md / SOUL.md, allow/deny tool lists and tool profile, primary model selection plus fallback chain.
- **D-10:** Created agent is written to the filesystem (`ZTech_Agents/<dept>/<team>/<Agent_Name>/`) with the appropriate files, and added to the database.

### Teams Panel — Docs Tab
- **D-11:** Fix the "Add Doc" button in `OrgDocsPanel` to create markdown files in `ZTech_Agents/<department>/<team>/docs/`.
- **D-12:** Fix separator lines in `OrgDocsPanel` that get cut off — they should span the full width.

### Teams Panel — Chat Tab
- **D-13:** Chat tab includes a sidebar showing previous conversations, filtered to the currently selected agent only.
- **D-14:** Default chat target is the team lead. A visually creative agent selector (not a simple dropdown) allows choosing any agent within the team.
- **D-15:** Selected agent in Chat tab persists across tab switches (Overview/Members/Docs/Chat).
- **D-16:** Reuse existing chat infrastructure (`EmbeddedChat`, `ChatInput`, `MessageBubble`) for message display and sending. Conversation history comes from the existing `/api/chat/messages` endpoint filtered by conversation ID.

### Department Panel — New Department Button
- **D-17:** Add a "New Department" button with the same visual prominence as New Team / Add Member buttons.
- **D-18:** Creates a directory in `ZTech_Agents/<DEPARTMENT_NAME>/` AND a database record.

### Department Panel — Manager Terminology (Full Rename)
- **D-19:** Rename all UI labels from "Department Lead" to "Department Manager".
- **D-20:** Full code-level rename: variable names, store actions, API params — change "lead" to "manager" for department context. (Team lead stays as "lead".)
- **D-21:** Department Managers are standalone agents not part of any team. The manager agent lives in `MANAGER/` directory inside each department (`ZTech_Agents/<dept>/MANAGER/`).
- **D-22:** If no manager exists, show a "Hire a Manager" button that opens a creation form (same fields as Add Member: name, role, model, identity files, tools, model chain).

### Department Panel — Overview Tab
- **D-23:** Show more detailed info about the department manager when assigned (similar to a summary card with role, model, status, recent activity).

### Department Panel — Docs Tab
- **D-24:** Fix the "New Doc" button — same approach as teams: create markdown files in `ZTech_Agents/<department>/docs/`.
- **D-25:** Fix separator lines that get cut off (same OrgDocsPanel fix as teams).

### Claude's Discretion
- Button styling approach for prominent action buttons (solid accent, outlined with glow, etc.) — whatever fits the dark panel aesthetic
- Agent selector creative design in Chat tab (avatar grid, pill selector, card strip, etc.)
- Internal component decomposition for the agent details card
- How to structure the agent creation form (single page vs stepped wizard)
- Exact layout of the vertical tab sidebar in the agent details card

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Panel Components
- `src/components/panels/teams-panel.tsx` — TeamsPanel + TeamDetail components, tab structure, existing member management
- `src/components/panels/departments-panel.tsx` — DepartmentsPanel + DepartmentDetail, tab structure, lead selector, team creation form
- `src/components/panels/agent-squad-panel-phase3.tsx` — AgentDetailModalPhase3 with all 11 tabs (reference for agent details card)

### Chat Infrastructure
- `src/components/chat/embedded-chat.tsx` — Reusable chat widget with message loading, sending, polling
- `src/components/chat/chat-workspace.tsx` — Full chat workspace with conversation management
- `src/components/chat/chat-input.tsx` — ChatInput component
- `src/components/chat/message-bubble.tsx` — MessageBubble component

### Docs Component
- `src/components/panels/org-docs-panel.tsx` — OrgDocsPanel (needs separator fix + add doc functionality)

### Data Layer
- `src/store/index.ts` — Department, Team, Agent types; store actions for assignments, leads
- `src/lib/org-scanner.ts` — Filesystem-based org scanning, directory structure conventions
- `src/lib/migrations.ts` — Database schema

### Agent Multi-Select (reference for existing pattern)
- `src/components/ui/agent-multi-select.tsx` — AgentMultiSelect component

### Prior Phase Context
- `.planning/phases/01-agent-chat-spaces-ui/01-CONTEXT.md` — Embedded chat routing, conversation ID format
- `.planning/phases/02-add-way-to-promote-agents-to-team-lead/02-CONTEXT.md` — Lead promotion APIs, source priority, org-scanner behavior

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AgentDetailModalPhase3`: Full 11-tab agent detail view — extract tab content components for reuse in the inline card
- `EmbeddedChat`: Self-contained chat widget with polling and message management
- `AgentMultiSelect`: Searchable agent selection (reference pattern, not directly reused since we're creating new agents)
- `OrgDocsPanel`: Docs display component — needs fixes but base functionality exists
- `ChatInput`, `MessageBubble`: Chat primitives for the Chat tab
- `useSmartPoll`: Polling hook for real-time updates
- `DraggableCard`, `DroppableZone`, `StatusDot`: DnD and status display helpers

### Established Patterns
- Tab-based panel layout with sidebar listing + detail view (both panels follow this)
- Store actions call API first, update local state on success (Phase 2 pattern)
- Org-scanner reads filesystem, `source: 'manual'` protects API-created records from rescans
- Inline confirmation for destructive actions (Phase 2 promote/demote pattern)
- Dark panel aesthetic with `bg-[hsl(var(--surface-*))]` variables

### Integration Points
- `handleAddTeam` in departments-panel.tsx — existing team creation logic (needs filesystem write added)
- `addTeam` store action — needs to support directory creation
- Org-scanner: must recognize new MANAGER/ directory convention for department managers
- API routes: new endpoints needed for agent creation, doc creation, department creation

</code_context>

<specifics>
## Specific Ideas

- The agent details card is NOT a modal — it's an inline card within the Overview tab, sitting next to the roster
- Vertical tabs on the left sidebar of the agent details card is a visual departure from the horizontal tabs in AgentDetailModalPhase3 — but tab content components should be shared
- Agent creation writes real files (IDENTITY.md, AGENT.md, SOUL.md) to the ZTech_Agents directory — the dashboard is no longer read-only
- The "pretty selection area" for chat agent selection should be creative (not a basic dropdown) — could be avatar chips, a mini-roster strip, or card-based selector
- Department manager lives in a dedicated MANAGER/ directory, separate from teams — org-scanner needs to understand this convention
- Docs are markdown files stored in `docs/` subdirectories within the ZTech_Agents tree

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-improve-the-teams-and-department-panels*
*Context gathered: 2026-03-30*
