# Feature Research

**Domain:** AI agent orchestration dashboard — agent lifecycle management, multi-runtime execution gateway, hierarchical task delegation
**Researched:** 2026-04-01
**Confidence:** HIGH (based on direct codebase audit + verified domain research)

---

## Context: What Already Exists

Before categorizing features, this is what the v1.0 codebase already delivers that is directly relevant to v1.1:

| Capability | Status | Location |
|------------|--------|----------|
| Org scan: reads AGENT.md, IDENTITY.md, SOUL.md, USER.md from ZTech_Agents dir | EXISTS | `src/lib/org-scanner.ts` |
| Agent metadata parsing: name, role, skills[], kpis[], dept, team, assignmentRole | EXISTS | `parseAgentMetadata()` in org-scanner.ts |
| Skills[] and KPIs[] stored in agent.config JSON blob | EXISTS | `ensureFilesystemAgent()` — stored as JSON, not first-class DB fields |
| Skills catalog (SKILL.md-based, 5 scan roots, disk<->DB sync) | EXISTS | `src/lib/skill-sync.ts`, `skill-registry.ts` |
| Runtime detection: openclaw, hermes, claude, codex | EXISTS | `src/lib/agent-runtimes.ts` |
| Runtime install (background jobs, local + docker) | EXISTS | `agent-runtimes.ts` + `src/app/api/agent-runtimes/route.ts` |
| Spawn API: fire-and-forget OpenClaw session spawn with task prompt | EXISTS | `src/app/api/spawn/route.ts` |
| Task dispatch to OpenClaw gateway (queue polling, model routing) | EXISTS | `src/lib/task-dispatch.ts` |
| Coordinator routing: resolve which agent gets a message | EXISTS | `src/lib/coordinator-routing.ts` |
| Task routing: extract impl_repo + code_location from task metadata | EXISTS | `src/lib/task-routing.ts` |
| Task queue API: agents poll for next task | EXISTS | `src/app/api/tasks/queue/route.ts` |

**Critical gap:** Skills from `agent/skills/` subdirectories in the ZTech_Agents directory are parsed as inline list items from AGENT.md text (metadata.skills[]), but NOT linked to the skills catalog (SKILL.md-based). The two skill systems are parallel and disconnected. The agent profile UI shows what a skill is named, but there is no drill-down to content, no skill assignment surface per agent, and no bridge between "skills this agent has per AGENT.md" and "installed SKILL.md definitions on disk."

**Second critical gap:** Hierarchical task delegation does not exist. The task schema has no `parent_id`, `delegated_by`, or subtask columns. There is no flow for a department lead to receive a task, break it into subtasks, and assign those subtasks to team members with status rollup. The coordinator-routing module routes chat messages to agents — it is not a task decomposition engine.

**Third gap:** Agent profiles in the UI use `soul_content` (SOUL.md text) but do not surface the richer metadata (KPIs, skills list, org path, protocol stack) that the scanner already extracts and stuffs into config JSON. The data exists in the DB but the agent profile view does not render it.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that are expected of any agent orchestration dashboard at this scope. Missing these creates friction and confusion.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Rich agent profile view — shows name, role, department, team, skills, KPIs, protocol stack, workspace path | Scanner already populates this data into config JSON; users expect to see it rendered, not raw JSON | LOW | Data exists; needs UI panel render + API to expose structured profile fields |
| Per-agent skills list sourced from AGENT.md/IDENTITY.md | Skills are parsed by org-scanner and stored in config.skills[]; users expect to see them on the agent card | LOW | API endpoint to expose structured config fields; UI render in agent detail panel |
| Link agent's inline skills list to installed SKILL.md definitions | When an agent lists "code-review" as a skill, and a code-review SKILL.md exists in the catalog, they should be visually linked | MEDIUM | Requires fuzzy name-matching bridge between config.skills[] and skills table |
| Agent `skills/` subdirectory import | ZTech_Agents convention includes agent-level `skills/` dirs alongside AGENT.md; those SKILL.md files should be imported to the skills catalog on scan | MEDIUM | org-scanner already reads the agent dir but does not recurse into skills/ subdir; add scan step that feeds skill-sync |
| Runtime status visible per agent | Every agent card should show which runtime it belongs to (Claude Code / OpenClaw / Codex) and whether that runtime is live | LOW | Runtime detection exists; agent.config can store runtime hint; UI must query and display |
| Spawn new session with task pre-filled from agent profile | Click an agent, choose "Delegate task", pre-fill the spawn form with agent name, model, workspace path | LOW | Spawn API exists; connect UI flow from agent card to spawn endpoint |
| Task delegation to a running persistent agent (send to active session) | Dispatching a task to an agent that already has an open gateway session — not spawning a new one | MEDIUM | task-dispatch.ts routes to gateway; the UI flow of "pick running session + assign task" needs connecting |
| Real-time runtime status across runtimes (openclaw running/down, claude authenticated) | Operator needs instant visibility into which runtimes are healthy before delegating | LOW | Runtime detection API exists; needs polling/SSE surface on dashboard |

### Differentiators (Competitive Advantage)

Features that are specific to the ZTech use case or go beyond what generic agent orchestration dashboards offer.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent `skills/` directory import during org scan | Automatically ingest each agent's personal SKILL.md files into the catalog at scan time — no manual import step | MEDIUM | Adds recursive dir scan in org-scanner; writes to skills table via skill-sync logic; keeps agent skills scoped to that agent's workspace |
| Hierarchical task delegation: user → dept lead → team lead → sub-agents | Matches the ZTech org structure; leads decompose incoming tasks and distribute to their team; provides full chain-of-custody | HIGH | Needs: (1) parent_task_id column on tasks, (2) subtask creation API, (3) lead receives task and sees "Delegate" action, (4) subtask status rollup to parent. No framework exists today. |
| Lead coordination panel — break a task into subtasks and assign to team members | Department/team leads get a dedicated "breakdown" view: one incoming task, N outgoing subtasks with assignment + status | HIGH | Depends on hierarchical task model; new UI panel; depends on team membership data from org-scanner |
| Skills-gated routing: route tasks to agents whose skill list matches the task's required skills | When creating a task, surface agents whose config.skills[] overlap with the task's tags/description | MEDIUM | Fuzzy match task tags against agent config.skills[]; suggest best-fit agent during task creation |
| Protocol stack display per agent (A2A, ACP, MCP, ICP) | Agents in ZTech define a protocol_stack field in AGENT.md; surface this in the profile so the operator knows how to interact with the agent | LOW | Parser needs to extract protocol_stack field from AGENT.md; render in agent detail panel |
| Multi-runtime spawn: choose runtime per task dispatch | When spawning a session or delegating a task, let the operator choose the runtime (Claude Code / OpenClaw / Codex) — not just OpenClaw | MEDIUM | Spawn API currently hardcoded to OpenClaw; extend to route to claude/codex CLIs; requires per-runtime spawn adapters |
| Org-path display in agent profile (Dept > Team > Agent) | Surface the full organizational path for each agent so the operator understands where in the hierarchy an agent sits | LOW | org-scanner already resolves dept + team; API needs to join and return them; render in agent detail |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-decompose tasks using LLM at create time | Seems like it would save the lead agent work | Nondeterministic: LLM decompositions are hard to validate, produce variable subtask quality, and require extra LLM calls and cost on every task creation. Violates the principle that the lead *agent* does decomposition. | Let the lead agent (running in a session) do decomposition and call the subtask creation API. Mission Control provides the *surface*, not the *intelligence*. |
| Write back to ZTech_Agents directory from the dashboard | Tempting to allow editing agent profiles in the UI | The ZTech_Agents directory is source-of-truth, version-controlled, and owned by humans. Dashboard writes risk merge conflicts, loss of formatting, and bypassing Git review. | Read-only from the dashboard. Display a file path + editor hint so the operator knows where to make changes. |
| Full SKILL.md editor inside the dashboard | Skills are text files; editing in a textarea is appealing | Skills need version control, review, and testing before deployment to agents. An in-app editor encourages unreviewed changes, breaks SHA verification, and creates security review gaps. | Show SKILL.md content read-only in the UI; install new skills from registry; instruct users to edit on disk via their editor. |
| Real-time multi-user collaboration on task board | Multi-user dashboards seem more capable | PROJECT.md explicitly lists "single operator managing the agent workforce" as a constraint. Multi-user adds auth complexity, locking, conflict resolution — none of which is justified for this use case. | SSE-based live feed already provides real-time updates for the single operator session. |
| Task auto-assignment by the dashboard | Matching tasks to agents automatically sounds efficient | The dashboard does not understand agent workload, skill depth, or current context well enough to make good assignment decisions. Auto-assignment without agent confirmation creates queue noise. | Provide skill-gated *suggestions* during task creation; let the operator or lead agent confirm the assignment. |

---

## Feature Dependencies

```
[Agent skills/ dir import during org scan]
    └──requires──> [org-scanner extended to recurse into agent/skills/ subdirs]
                       └──requires──> [skill-sync: existing upsert logic, already present]

[Hierarchical task delegation]
    └──requires──> [tasks table: parent_task_id column + migration]
                       └──requires──> [subtask creation API (POST /api/tasks with parent_id)]
                                          └──requires──> [lead agent receives task and sees Delegate action]
                                                             └──requires──> [task assigned_to resolved to agent record with team membership]

[Lead coordination panel]
    └──requires──> [Hierarchical task delegation (above)]
    └──requires──> [Org scan: team membership data (already exists via agentAssignments)]

[Skills-gated routing / best-fit agent suggestion]
    └──requires──> [Agent skills stored as queryable fields, not JSON blob]
    └──enhances──> [Task creation form (already exists)]

[Multi-runtime spawn]
    └──requires──> [Per-runtime spawn adapters: claude CLI, codex CLI, openclaw gateway]
    └──enhances──> [Spawn API (already exists, currently OpenClaw-only)]

[Rich agent profile view]
    └──requires──> [API to expose structured config fields from agent.config JSON]
    └──requires──> [UI: agent detail panel extended to render skills, KPIs, org-path, protocol stack]

[Protocol stack display]
    └──requires──> [org-scanner: parse protocol_stack field from AGENT.md]
    └──requires──> [Rich agent profile view (above)]
```

### Dependency Notes

- **Hierarchical task delegation requires DB migration:** The tasks table schema has no `parent_task_id`. This migration must happen before any subtask API or UI work.
- **Skills-gated routing requires structured skills storage:** Currently skills are stored as `config.skills[]` inside a JSON blob. Querying for "agents with skill X" requires JSON parsing in SQLite (possible with json_extract but fragile). Promoting skills to a proper `agent_skills` join table makes routing queries clean.
- **Agent skills/ dir import is independent:** It only touches org-scanner and skill-sync — no UI changes needed for the core import. The link between agent-level skills and the catalog is a separate UI concern.
- **Multi-runtime spawn is independent of task delegation:** You can add Claude Code + Codex spawn adapters without touching the task hierarchy schema.

---

## MVP Definition

### Launch With (v1.1)

Minimum features that deliver the milestone's stated goal: "full agent lifecycle from enriched metadata profiles through multi-runtime execution and hierarchical task delegation."

- [ ] **Rich agent profile API + UI** — Expose structured fields (skills[], kpis[], orgPath, protocolStack) from agent.config to the agent detail panel. Data exists; this is a rendering gap. Why essential: the profile is the entry point for everything else in this milestone.
- [ ] **Agent skills/ subdirectory import** — Extend org-scanner to recursively scan `Agent_Name/skills/` during org sync and feed discovered SKILL.md files to the skills catalog. Why essential: this is the skills import requirement from PROJECT.md.
- [ ] **Hierarchical task model (DB + API)** — Add `parent_task_id` + `delegated_by` columns to tasks, create subtask creation endpoint, expose subtask list in task detail. Why essential: without this, hierarchical delegation is architecturally impossible.
- [ ] **Lead delegation UI** — When a task is assigned to an agent who is a team lead, show a "Delegate to team" action that opens a subtask breakdown form. Why essential: this is the core orchestration value of the milestone.
- [ ] **Multi-runtime spawn (Claude Code + Codex)** — Extend the spawn API to route to `claude` and `codex` CLIs in addition to the OpenClaw gateway. Why essential: PROJECT.md lists multi-runtime execution as a key requirement.
- [ ] **Runtime status surface on agent cards** — Show which runtime each agent is configured for and whether that runtime is currently live. Why essential: the operator must know runtime health before delegating tasks.

### Add After Validation (v1.x)

Features to add once the core flows are proven working.

- [ ] **Skills-gated agent suggestions** — Surface best-fit agent recommendations during task creation based on skill overlap. Add when: skill import is stable and skills data is consistently present in profiles.
- [ ] **Protocol stack display** — Parse and render `protocol_stack` field from AGENT.md in agent profile. Add when: rich profile view is live and protocol_stack field is confirmed present in ZTech_Agents files.
- [ ] **Subtask status rollup** — Parent task status auto-updates based on subtask completion percentage. Add when: hierarchical task model is in production and real usage patterns are understood.
- [ ] **Skill-to-agent linking** — Visual link in agent profile between inline skill names (from AGENT.md) and installed SKILL.md catalog entries. Add when: skills catalog is populated from agent/skills/ dirs in production.

### Future Consideration (v2+)

Features to defer until the v1.1 flows are validated.

- [ ] **Cross-department task routing** — Route tasks across department boundaries via dept leads. Defer: adds significant routing complexity; single-department flows must be stable first.
- [ ] **Task delegation audit trail / chain of custody view** — Visual trace of who delegated what to whom across the hierarchy. Defer: needs production delegation data to understand what the UI should show.
- [ ] **Runtime health alerts** — Auto-alert when a runtime goes from running to down during active task execution. Defer: requires stateful monitoring beyond current polling model.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Rich agent profile API + UI (structured fields) | HIGH | LOW | P1 |
| Agent skills/ subdirectory import | HIGH | MEDIUM | P1 |
| Hierarchical task model (DB schema + API) | HIGH | MEDIUM | P1 |
| Lead delegation UI | HIGH | HIGH | P1 |
| Multi-runtime spawn (Claude Code + Codex) | HIGH | MEDIUM | P1 |
| Runtime status on agent cards | MEDIUM | LOW | P1 |
| Skills-gated agent suggestions | MEDIUM | MEDIUM | P2 |
| Protocol stack display | LOW | LOW | P2 |
| Subtask status rollup | HIGH | MEDIUM | P2 |
| Skill-to-agent linking in profile | MEDIUM | MEDIUM | P2 |
| Cross-department routing | HIGH | HIGH | P3 |
| Delegation audit trail view | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.1 launch — directly addresses milestone requirements
- P2: Should have — enhances core flows, add in v1.1 patches
- P3: Nice to have — defer to v2+

---

## Competitor Feature Analysis

| Feature | LangGraph / CrewAI | Generic Agent Dashboards (LangSmith, Helicone) | Our Approach |
|---------|-------------------|-------------------------------------------------|--------------|
| Agent metadata profile | Schema-defined via code; no file-based convention | Log-derived; shows run metadata, not agent identity | File-based: parse AGENT.md/IDENTITY.md from org directory; operator-editable without code changes |
| Skills catalog | Hardcoded tool lists in agent definition code | Not a concept; tools are code | File-based SKILL.md standard; separates skill definition from agent code; portable across runtimes |
| Hierarchical delegation | Supervisor pattern in LangGraph; requires graph definition | Not supported; flat task assignment | Org-structure-aware: leads identified from directory metadata; delegation follows the actual org chart |
| Multi-runtime support | Single framework (LangGraph is Python-native) | Single runtime observability | Runtime-agnostic gateway: detect and dispatch to openclaw, claude, codex from one UI |
| Org discovery | Manual agent registration | Not a concept | Auto-discover from filesystem directory tree; no registration step required |

---

## Implementation Notes by Feature Area

### Agent Metadata Profile

The parser in `org-scanner.ts:parseAgentMetadata()` already extracts `name`, `role`, `skills[]`, `kpis[]`, `department`, `team`, `assignmentRole`. These land in `agent.config` as a JSON blob under `folderOrg`, `skills`, `kpis` keys.

Gap: the agent detail API (`/api/agents/[id]`) returns the raw `config` column. The UI must either parse JSON client-side (fragile) or the API should expose a structured `profile` object. Recommend: add a `GET /api/agents/[id]/profile` endpoint that parses and normalizes the config blob into a typed profile shape.

Additionally, `parseAgentMetadata()` does not yet extract `protocol_stack`, `deliverables`, `dependencies`, or `reporting_chain` fields mentioned in PROJECT.md context. These fields should be added to the parser for complete v1.1 profiles.

### Skills Import from Agent Directories

`org-scanner.ts:syncFilesystemAgentFromPath()` reads `AGENT.md`, `IDENTITY.md`, `SOUL.md`, `USER.md` but does not recurse into `skills/`. Add a step that checks for a `skills/` subdirectory and iterates its contents, calling `skill-sync` logic for any `SKILL.md` found. The skill's `source` should be set to `workspace-<agent-name>` to distinguish it from global skills — `skill-sync.ts` already handles dynamic `workspace-*` sources.

### Hierarchical Task Model

The tasks table needs a migration (not a schema rewrite). Add:
- `parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE` — links subtask to parent
- `delegated_by TEXT` — agent name or username who created the subtask
- `delegation_note TEXT` — optional context the delegating lead attached

The `task-dispatch.ts` model-routing logic already handles per-agent config overrides and should flow through to subtasks using the assigned sub-agent's config.

### Multi-Runtime Spawn

`agent-runtimes.ts` already detects and can install all four runtimes. `spawn/route.ts` only calls `callOpenClawGateway()`. To add Claude Code and Codex:
- Claude Code: `claude -p "<task>"` with `--output-format json` flag (non-interactive mode)
- Codex: `codex run "<task>"` (non-interactive mode; Codex CLI supports `run` subcommand)
- Both can reuse the existing `runCommand()` utility in `src/lib/command.ts`
- Store runtime in `agent.config.runtime` so tasks dispatched to that agent know which CLI to call

---

## Sources

- Codebase audit: `src/lib/org-scanner.ts`, `skill-sync.ts`, `skill-registry.ts`, `agent-runtimes.ts`, `task-dispatch.ts`, `coordinator-routing.ts`, `task-routing.ts`
- [AI Agent Orchestration in 2026: What Enterprises Need to Know](https://kanerika.com/blogs/ai-agent-orchestration/)
- [AI Agent Skills Guide 2026 — Serenities AI](https://serenitiesai.com/articles/agent-skills-guide-2026)
- [Multi-Agent Orchestration Patterns: Complete Guide 2026 — Fast.io](https://fast.io/resources/multi-agent-orchestration-patterns/)
- [Agent Orchestration Patterns: Swarm vs Mesh vs Hierarchical — GuruSup](https://gurusup.com/blog/agent-orchestration-patterns)
- [AI Agent Orchestration Patterns — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [ACP Agents — OpenClaw Docs](https://docs.openclaw.ai/tools/acp-agents)
- [OpenClaw Multi-Agent Orchestration Advanced Guide](https://zenvanriel.com/ai-engineer-blog/openclaw-multi-agent-orchestration-guide/)
- [Soul Spec — Open Standard for AI Agent Personas](https://soulspec.org/)
- [Custom instructions with AGENTS.md — OpenAI Codex Docs](https://developers.openai.com/codex/guides/agents-md)
- [Agent metadata and discoverability patterns — Microsoft Learn](https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/agent-metadata-discoverability)

---
*Feature research for: ZTech Mission Control v1.1 — Agent Gateway Integration*
*Researched: 2026-04-01*
