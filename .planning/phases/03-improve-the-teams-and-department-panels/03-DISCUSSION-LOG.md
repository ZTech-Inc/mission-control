# Phase 3: Improve the Teams and Department Panels - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 03-improve-the-teams-and-department-panels
**Areas discussed:** New Team creation, Chat tab agent filtering, Add Member modal, Hire Manager flow, Agent creation form fields, Write path constraint, Manager terminology rename scope, Docs storage, Default agent view, Button styling, OrgDocsPanel fix approach, Chat selection persistence

---

## New Team Creation

| Option | Description | Selected |
|--------|-------------|----------|
| Database record only | Create team in SQLite via API — no filesystem changes | |
| Create directory + DB | Create folder in ZTech_Agents AND database record | ✓ |

**User's choice:** Create directory + DB
**Notes:** Overrides the PROJECT.md read-only constraint for creation operations.

---

## Chat Tab Agent Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Team lead only | Chat tab always shows conversations with the team's lead agent | |
| Selected agent | Chat tab follows the agent selected in the Overview tab's details card | |

**User's choice:** Other — "By default you chat with the team lead. But there should be a pretty selection area to choose the agent you wanna chat with (show only agents within the selected team). Don't make it a simple dropdown menu. Be creative with this."
**Notes:** Creative agent selector required, not a basic dropdown. Shows only team members.

---

## Add Member Modal

| Option | Description | Selected |
|--------|-------------|----------|
| Assign existing agent | Modal shows searchable list of existing agents | |
| Create new agent | Modal has form fields to define a new agent | ✓ |
| Both options | Modal offers tabs: 'Add existing' or 'Create new' | |

**User's choice:** Create new agent
**Notes:** Full agent creation with filesystem write.

---

## Hire Manager

| Option | Description | Selected |
|--------|-------------|----------|
| Select from existing agents | Opens dropdown/modal to pick an existing unassigned agent | |
| Create new manager agent | Opens form to define new manager agent, creates MANAGER directory | ✓ |

**User's choice:** Create new manager agent
**Notes:** Creates MANAGER/ directory inside the department in ZTech_Agents.

---

## Agent Creation Form Fields

| Option | Description | Selected |
|--------|-------------|----------|
| Basic info only | Name, role, model — minimal fields | |
| Identity files | Editable text areas for IDENTITY.md, AGENT.md, SOUL.md | ✓ |
| Tool configuration | Allow/deny tool lists and tool profile | ✓ |
| Model + fallbacks | Primary model selection plus fallback chain | ✓ |

**User's choice:** Identity files + Tool configuration + Model + fallbacks (multi-select)
**Notes:** Comprehensive creation form with all configuration options.

---

## Write Path Constraint

| Option | Description | Selected |
|--------|-------------|----------|
| Write to ZTech_Agents | Remove read-only constraint — dashboard can create directories/files | ✓ |
| Separate workspace | Keep ZTech_Agents read-only, write new agents/teams elsewhere | |

**User's choice:** Write to ZTech_Agents
**Notes:** PROJECT.md constraint needs updating.

---

## Manager Terminology Rename Scope

| Option | Description | Selected |
|--------|-------------|----------|
| UI labels only | Change displayed text only — keep API/DB field names | |
| Full rename | Rename UI labels AND code-level references | ✓ |

**User's choice:** Full rename
**Notes:** Variables, store actions, API params all renamed from "lead" to "manager" for department context. Team lead stays as "lead".

---

## Docs Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown file in workspace | Creates .md file in team/department directory in ZTech_Agents | ✓ |
| Database-stored doc | Stores document content in SQLite | |

**User's choice:** Other — "Markdown files inside ZTech_Agents/<department>/docs for departmental docs and ZTech_Agents/<department>/<team>/docs for team wise docs"
**Notes:** Specific directory convention for docs within the ZTech_Agents tree.

---

## Default Agent View

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-load team lead | Card immediately shows team lead's details | ✓ |
| Empty state first | Shows 'Select an agent to view details' until user clicks | |

**User's choice:** Other — "Pre-load team lead. Show the team lead being selected. If no team lead is assigned, show an empty state prompting to select an agent. The selected agent must be highlighted."
**Notes:** Conditional: lead exists → pre-load with highlight; no lead → empty state.

---

## Button Styling

| Option | Description | Selected |
|--------|-------------|----------|
| Accent-colored solid | Filled button with theme accent color | |
| Outlined with glow | Border button with subtle glow/highlight effect | |
| You decide | Claude picks best approach for dark panel aesthetic | ✓ |

**User's choice:** You decide

---

## OrgDocsPanel Fix Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Fix OrgDocsPanel | Patch existing component — fix separator width, add doc button | ✓ |
| Rebuild inline | Remove OrgDocsPanel dependency, build simpler docs section | |

**User's choice:** Fix OrgDocsPanel

---

## Chat Selection Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Persist selection | Selected agent stays chosen when switching tabs | ✓ |
| Reset to lead | Always resets to team lead when switching back to Chat | |

**User's choice:** Persist selection

---

## Claude's Discretion

- Button styling for prominent action buttons
- Agent selector creative design in Chat tab
- Internal component decomposition
- Agent creation form layout (single page vs wizard)
- Vertical tab sidebar layout in agent details card

## Deferred Ideas

None — discussion stayed within phase scope
