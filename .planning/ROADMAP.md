# Roadmap — ZTech Mission Control

## Milestones

- ✅ **v1.0 Agent Chat Spaces** — Phases 1-3 shipped 2026-04-01. See `.planning/milestones/v1.0-ROADMAP.md`
- **v1.1 Agent Gateway Integration** — Phases 4-7 (active)

## Phases

- [ ] **Phase 4: Agent Profile Enrichment** — Parse agent definition files into structured DB columns and render rich profiles in the UI
- [ ] **Phase 5: Skills Import and Linking** — Import SKILL.md files from agent `skills/` subdirectories and link inline skill names to catalog entries
- [ ] **Phase 6: Multi-Runtime Gateway** — Extend dispatch to Claude Code and Codex runtimes with runtime status visible on agent cards
- [ ] **Phase 7: Hierarchical Task Delegation** — Add parent-child task model and lead delegation UI with subtask status rollup

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 4. Agent Profile Enrichment | 0/2 | Planned | - |
| 5. Skills Import and Linking | 0/? | Not started | - |
| 6. Multi-Runtime Gateway | 0/? | Not started | - |
| 7. Hierarchical Task Delegation | 0/? | Not started | - |

## Phase Details

### Phase 4: Agent Profile Enrichment
**Goal**: Agent definition files (AGENT.md, IDENTITY.md, SOUL.md, USER.md) are fully parsed and their structured fields — skills, KPIs, deliverables, dependencies, protocol stack, reporting chain — are stored as queryable schema columns and rendered in the agent detail panel.
**Depends on**: Phase 3 (v1.0) — org scanner, agents table, agent detail panel all exist
**Requirements**: PROF-01, PROF-02, PROF-03
**Success Criteria** (what must be TRUE):
  1. Viewing an agent's detail panel shows name, role, skills, KPIs, org path, protocol stack, and deliverables as structured fields — not a raw JSON blob
  2. The agents table has discrete columns for `protocol_stack`, `kpis`, `deliverables`, `dependencies`, `preferred_runtime`, and `workspace_path` that can be queried directly via SQL
  3. Running an org rescan for a directory of agents populates all new profile fields without overwriting manually assigned lead roles
  4. An agent's `openclawId` is derived and stored at import time so that downstream dispatch does not rely on display-name matching
**Plans:** 2 plans
Plans:
- [ ] 04-01-PLAN.md — Migration 051, profile parser module with tests, Agent type update
- [ ] 04-02-PLAN.md — Wire parser into org-scanner, update API, build ProfileTab UI

### Phase 5: Skills Import and Linking
**Goal**: SKILL.md files from each agent's `skills/` subdirectory are imported into the global skills catalog with isolated source keys, and agent profiles visually link inline skill names to their corresponding catalog entries.
**Depends on**: Phase 4 — `workspace_path` must be populated for the importer to locate agent skill directories
**Requirements**: SKIL-01, SKIL-02
**Success Criteria** (what must be TRUE):
  1. After an org scan, the skills catalog contains entries for every SKILL.md file found under agent `skills/` subdirectories, each attributed to its source agent via a namespaced key (`org-agent:<name>`)
  2. Skill entries imported from agent directories do not disappear when the global `syncSkillsFromDisk()` routine runs
  3. In an agent's profile panel, inline skill names that match a catalog entry are rendered as clickable links that open the corresponding SKILL.md detail
**Plans**: TBD

### Phase 6: Multi-Runtime Gateway
**Goal**: Operators can spawn agent sessions and dispatch tasks on Claude Code and Codex runtimes — not just OpenClaw — and agent cards show which runtime each agent uses along with that runtime's live availability.
**Depends on**: Phase 4 — `preferred_runtime` and `workspace_path` in agent config are required for runtime routing
**Requirements**: RUNT-01, RUNT-02, RUNT-03
**Success Criteria** (what must be TRUE):
  1. User can dispatch a task to an agent whose preferred runtime is Claude Code and receive a non-null session ID with streaming status updates
  2. User can dispatch a task to an agent whose preferred runtime is Codex and receive output back via the standard task response surface
  3. Every agent card shows a runtime badge (e.g. "Claude Code", "OpenClaw", "Codex") alongside a live/offline indicator that reflects the runtime's current availability
  4. When dispatching a specific task, the user can override the agent's default runtime and select a different supported runtime from a dropdown
**Plans**: TBD

### Phase 7: Hierarchical Task Delegation
**Goal**: Tasks support a parent-child hierarchy, team and department leads can break an incoming task into subtasks and assign them to team members, and parent task status automatically reflects subtask completion progress.
**Depends on**: Phase 4 (agent identity correct), Phase 5 (skills context for leads), Phase 6 (all runtimes dispatchable)
**Requirements**: DELG-01, DELG-02, DELG-03
**Success Criteria** (what must be TRUE):
  1. The `tasks` table has a `parent_task_id` column with `ON DELETE CASCADE` and a `delegated_by` field, and all existing task queries remain unaffected by the migration
  2. A team lead agent can receive a task, open a delegation breakdown surface, create named subtasks with assignees, and submit them — resulting in child tasks visible under the parent in the task board
  3. The parent task's status badge updates automatically as subtasks move through the board: showing in-progress when any subtask is active, and complete only when all subtasks are done
  4. Cancelling or deleting a parent task removes its child tasks without leaving orphaned rows in the tasks table
**Plans**: TBD
