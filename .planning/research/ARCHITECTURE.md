# Architecture Research

**Domain:** Agent gateway integration — metadata ingestion, skills import, multi-runtime execution, hierarchical task delegation
**Researched:** 2026-04-01
**Confidence:** HIGH (based on direct codebase analysis)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Browser (React 19 / Zustand)                                                │
│  ┌────────────────┐  ┌───────────────┐  ┌────────────────┐  ┌─────────────┐ │
│  │ AgentSquadPanel│  │ SkillsPanel   │  │ TaskBoardPanel │  │ GatewayPanel│ │
│  │ (profile view) │  │ (agent skills)│  │ (delegation UI)│  │ (runtime)   │ │
│  └───────┬────────┘  └───────┬───────┘  └───────┬────────┘  └──────┬──────┘ │
│          │                  │                  │                   │        │
│          └──────────────────┴──────────────────┴───────────────────┘        │
│                                SSE / fetch                                   │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
┌───────────────────────────────────────▼──────────────────────────────────────┐
│  Next.js App Router (API routes under src/app/api/)                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ /api/agents  │  │ /api/skills   │  │ /api/tasks   │  │ /api/gateways   │ │
│  │  [id]        │  │  (existing)   │  │  queue/route │  │  health/connect │ │
│  └──────┬───────┘  └───────┬───────┘  └──────┬───────┘  └────────┬────────┘ │
│         │                 │                 │                    │          │
│  ┌──────▼──────────────────▼─────────────────▼────────────────────▼────────┐ │
│  │                        src/lib/ (core logic)                            │ │
│  │  org-scanner.ts    skill-sync.ts    task-dispatch.ts   agent-runtimes.ts│ │
│  │  (NEW: agent-      (NEW: agent-     (MODIFY: runtime   (EXISTS: claude, │ │
│  │  profile-parser)   skills-importer) selector, codex)   codex, openclaw) │ │
│  └──────────────────────────────┬──────────────────────────────────────────┘ │
└─────────────────────────────────┼────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────────────┐
│  Data Layer                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  SQLite (better-sqlite3)                                             │    │
│  │  agents table + config JSON blob                                     │    │
│  │  skills table (existing, disk-sync'd)                                │    │
│  │  tasks table + parent_task_id (NEW migration)                        │    │
│  │  gateways table (existing)                                           │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────────────┐
│  External Runtimes                                                           │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐    │
│  │ Claude Code CLI    │  │ OpenClaw HTTP Gateway│  │ Codex CLI          │    │
│  │ subprocess spawn   │  │ callOpenClawGateway()│  │ subprocess spawn   │    │
│  │ --print flag       │  │ (already wired)      │  │ (NEW path needed)  │    │
│  └────────────────────┘  └─────────────────────┘  └────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `org-scanner.ts` | Scans ZTech_Agents directory, persists agents/teams/departments to SQLite | EXISTS — needs agent profile enrichment extension |
| `parseAgentMetadata()` in org-scanner | Parses AGENT.md + IDENTITY.md for name, role, skills, kpis | EXISTS — needs SOUL.md + USER.md protocol fields |
| `skill-sync.ts` | Scans 6 disk roots for SKILL.md, bidirectional DB sync | EXISTS — needs ZTech_Agents `skills/` subdirectory as additional root |
| `agent-runtimes.ts` | Detects + installs openclaw/hermes/claude/codex | EXISTS — detection logic already covers all 3 target runtimes |
| `task-dispatch.ts` | Dispatches tasks via OpenClaw gateway OR direct Claude API | EXISTS — needs Codex CLI dispatch path + runtime selector |
| `coordinator-routing.ts` | Resolves which OpenClaw agent receives a delegated message | EXISTS — needs extension for hierarchical (lead → sub-agent) routing |
| `openclaw-gateway.ts` | Wraps `openclaw gateway call` subprocess | EXISTS — already used by spawn and dispatch |
| `event-bus.ts` | SSE broadcast of typed events to browser | EXISTS — `agent.updated`, `task.updated` events already defined |
| `spawn-history.ts` | Persists spawn records with status/duration | EXISTS — used by Claude Code spawns already |
| `gateways` table | Registry of gateway endpoints (host/port/token) | EXISTS — `ensureTable()` in route.ts |
| `agents.config` JSON | Per-agent JSON blob stores orgSource, folderOrg, skills, kpis | EXISTS — extend for runtime preference, protocol stack |
| NEW: `agent-profile-parser.ts` | Parses SOUL.md + USER.md + protocol fields from agent directory | NEW |
| NEW: `agent-skills-importer.ts` | Reads ZTech_Agents `skills/` subdirs, syncs to DB per-agent | NEW |
| NEW: `delegation-engine.ts` | Implements user → dept-lead → team-lead → sub-agent task fan-out | NEW |

## Recommended Project Structure

The existing structure is well-organized. New files fit into existing locations without new top-level directories.

```
src/
├── lib/
│   ├── org-scanner.ts          # MODIFY: call parseFullAgentProfile(), trigger skill import
│   ├── agent-profile-parser.ts # NEW: parse SOUL.md, USER.md, protocol stack fields
│   ├── agent-skills-importer.ts# NEW: import skills/ subdirs per-agent into skills table
│   ├── task-dispatch.ts        # MODIFY: add codex dispatch path, runtime selector
│   ├── delegation-engine.ts    # NEW: hierarchical task fan-out logic
│   ├── agent-runtimes.ts       # EXISTS (no change needed for v1.1)
│   ├── coordinator-routing.ts  # MODIFY: add team-lead resolution tier
│   └── skill-sync.ts           # MODIFY: add ZTech_Agents skills roots
├── app/api/
│   ├── agents/
│   │   ├── [id]/
│   │   │   ├── profile/        # NEW route: GET enriched agent profile
│   │   │   └── skills/         # NEW route: GET skills linked to agent
│   │   └── route.ts            # EXISTS (no change)
│   ├── tasks/
│   │   ├── delegate/           # NEW route: POST delegate task down hierarchy
│   │   └── route.ts            # EXISTS
│   └── gateways/
│       └── route.ts            # EXISTS (no change)
└── components/panels/
    ├── agent-squad-panel.tsx   # MODIFY: show enriched profile fields
    ├── agent-detail-tabs.tsx   # MODIFY: add Skills tab, Protocol Stack tab
    ├── task-board-panel.tsx    # MODIFY: add Delegate button, show sub-tasks
    └── gateway-config-panel.tsx# MODIFY: show per-runtime status + dispatch path
```

### Structure Rationale

- **`agent-profile-parser.ts` as separate file:** `org-scanner.ts` is already large (707 lines). Splitting the deeper file-parsing into its own module keeps `org-scanner.ts` at the orchestration level — scan directory, call parser, persist results.
- **`delegation-engine.ts` as separate file:** Hierarchical fan-out logic is stateful and complex enough to warrant isolation from the simpler one-shot `task-dispatch.ts`. These two modules compose: dispatch sends a single task; delegation engine creates and dispatches multiple sub-tasks.
- **`agent-skills-importer.ts` as separate file:** `skill-sync.ts` handles global disk roots. Per-agent skill import from the ZTech_Agents directory tree is a different concern (agent-scoped, source is org directory, not skill registry roots).
- **New API routes under existing prefixes:** Follows current convention — no new top-level API segments.

## Architectural Patterns

### Pattern 1: Extend `agents.config` JSON Blob (Agent Profile Enrichment)

**What:** Agent metadata beyond name/role/soul_content lives in the `config` TEXT column as a JSON blob. The scanner already writes `orgSource`, `folderOrg`, `skills`, `kpis` into this blob. New fields (protocolStack, deliverables, reportingChain, runtime preference) are added to the same blob.

**When to use:** When new agent-scoped metadata does not require cross-agent queries or indexing. Adding a column to the `agents` table is reserved for fields that need to be queryable via SQL (`WHERE`, `ORDER BY`, foreign key).

**Trade-offs:** Simple to add, no migration needed for optional fields. Harder to query inside SQLite (requires `json_extract()`). Acceptable for display-only metadata.

**Example:**
```typescript
// In agent-profile-parser.ts
export interface AgentProfileExtension {
  protocolStack?: string[]          // ['A2A', 'ACP', 'MCP', 'ICP']
  deliverables?: string[]           // from AGENT.md Deliverables section
  reportingChain?: string           // "reports to: Team Lead Name"
  preferredRuntime?: 'claude' | 'openclaw' | 'codex'
  userPersona?: string              // USER.md first heading / summary
}

// In org-scanner.ts, extend existing mergeConfig() call:
const agentId = ensureFilesystemAgent({
  ...
  config: {
    orgSource: 'filesystem',
    folderOrg,
    skills: metadata.skills,
    kpis: metadata.kpis,
    ...parseFullAgentProfile(agentPath),   // NEW: adds protocol, deliverables, etc.
  },
})
```

### Pattern 2: Per-Agent Skills Root in `skill-sync.ts`

**What:** `skill-sync.ts` maintains a list of `{source, path}` roots to scan. Adding ZTech_Agents agent-scoped `skills/` subdirs is done by extending `getSkillRoots()` to include one root per agent in the org scanner's snapshot.

**When to use:** When agent skills live inside the ZTech_Agents directory tree at `Department/TEAM/Agent_Name/skills/` and need to be imported to the global `skills` table alongside registry-installed skills.

**Trade-offs:** Reuses the entire existing deduplication and hash-change detection logic. The `source` field on each skill row will be `agent-{agentName}` to distinguish from registry sources.

**Example:**
```typescript
// In agent-skills-importer.ts — called once during or after org scan
export function importAgentSkillRoots(snapshot: OrgSnapshot): void {
  const db = getDatabase()
  // For each agent with a workspace_path, check for skills/ subdir
  const rows = db.prepare(
    `SELECT id, name, workspace_path FROM agents WHERE source = 'filesystem' AND workspace_path IS NOT NULL`
  ).all() as Array<{ id: number; name: string; workspace_path: string }>

  for (const row of rows) {
    const skillsDir = path.join(row.workspace_path, 'skills')
    if (!existsSync(skillsDir)) continue
    // Delegate to the existing scanDiskSkills() approach via syncSkillsFromDisk()
    // with the agent-scoped root injected
    syncAgentSkillRoot({ source: `agent-${row.name}`, path: skillsDir, agentId: row.id })
  }
}
```

### Pattern 3: Runtime Selector in `task-dispatch.ts`

**What:** `task-dispatch.ts` already branches between OpenClaw gateway and direct Claude API (`isGatewayAvailable()`). Adding Codex requires a third branch. The selector reads `agent.config.preferredRuntime` first, then falls back to environment-level detection.

**When to use:** When dispatching any task where the assigned agent has a declared runtime preference in their profile (written during org scan).

**Trade-offs:** Simple conditional dispatch — no new abstraction layer needed. Codex CLI is spawned as a subprocess with `--print` flag (non-interactive), same pattern as existing Claude Code subprocess invocations in `spawn/route.ts`.

**Example:**
```typescript
// In task-dispatch.ts — new function
async function dispatchToCodex(task: DispatchableTask, prompt: string): Promise<AgentResponseParsed> {
  const result = await runCommand('codex', [
    '--approval-mode', 'full-auto',
    '--print',         // non-interactive output mode
    prompt,
  ], { timeoutMs: 120_000 })

  return { text: result.stdout.trim() || null, sessionId: null }
}

// Extend dispatchTask() branching:
const runtime = resolveAgentRuntime(task)   // reads config.preferredRuntime
if (runtime === 'codex') return dispatchToCodex(task, prompt)
if (runtime === 'openclaw' && isGatewayAvailable()) return dispatchViaGateway(task, prompt)
return callClaudeDirectly(task, prompt)     // existing fallback
```

### Pattern 4: Parent Task for Hierarchical Delegation

**What:** A single new nullable column `parent_task_id` on the `tasks` table (SQLite migration) enables the hierarchy. A delegated task is a child task pointing to its parent. The delegation engine creates child tasks, assigns them to sub-agents, and marks the parent as `delegated` status.

**When to use:** When a team lead agent or the operator wants to break down a task and distribute pieces to sub-agents. The parent task's status is driven by aggregation over its children.

**Trade-offs:** Minimal schema change. Status roll-up (all children done → parent done) requires a query at status-change time. Avoids a separate `delegations` table.

**Example:**
```typescript
// Migration: add parent_task_id to tasks table
db.exec(`ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id)`)

// In delegation-engine.ts
export async function delegateTask(params: {
  parentTaskId: number
  subtasks: Array<{ title: string; description: string; assignedTo: string }>
  workspaceId: number
}): Promise<number[]> {
  const db = getDatabase()
  const childIds: number[] = []
  for (const sub of params.subtasks) {
    const result = db.prepare(
      `INSERT INTO tasks (title, description, status, assigned_to, parent_task_id, workspace_id, created_by, priority)
       VALUES (?, ?, 'assigned', ?, ?, ?, 'system', 'medium')`
    ).run(sub.title, sub.description, sub.assignedTo, params.parentTaskId, params.workspaceId, 'delegation')
    childIds.push(result.lastInsertRowid as number)
    eventBus.broadcast('task.created', { taskId: result.lastInsertRowid })
  }
  // Mark parent as delegated
  db.prepare(`UPDATE tasks SET status = 'delegated' WHERE id = ?`).run(params.parentTaskId)
  eventBus.broadcast('task.status_changed', { taskId: params.parentTaskId, status: 'delegated' })
  return childIds
}
```

## Data Flow

### Agent Profile Ingestion Flow (org scan → DB)

```
AGENTS_DIR filesystem
    │
    ▼
org-scanner.ts: scanFilesystemOrg()
    │  (existing: reads AGENT.md, IDENTITY.md, SOUL.md, USER.md)
    │  (NEW: calls parseFullAgentProfile() for protocol/deliverables/runtime)
    ▼
ensureFilesystemAgent()
    │  writes: agents.name, agents.role, agents.soul_content
    │  writes: agents.config JSON (folderOrg, skills, kpis + NEW fields)
    ▼
SQLite agents table
    │
    ▼
(after scan) agent-skills-importer.ts: importAgentSkillRoots()
    │  reads: agents.workspace_path WHERE source='filesystem'
    │  scans: workspace_path/skills/ for SKILL.md files
    ▼
SQLite skills table
    │  source = 'agent-{agentName}', linked via agent_id
```

### Task Delegation Flow (user → hierarchy → sub-agents)

```
Operator (UI or API)
    │  POST /api/tasks/delegate { taskId, depth }
    ▼
delegation-engine.ts: delegateTask()
    │  1. Resolve lead agent for task's assigned department/team
    │  2. Call lead agent via task-dispatch.ts with breakdown prompt
    │  3. Parse lead agent response for sub-task list
    │  4. Create child tasks in DB (parent_task_id set)
    │  5. Assign each child task to resolved sub-agent
    │  6. Dispatch each child task via runtime-appropriate path
    ▼
task-dispatch.ts: dispatchTask()
    │  Runtime selection: openclaw | claude (direct) | codex
    ├─► OpenClaw gateway: callOpenClawGateway('sessions_spawn', ...)
    ├─► Claude Code: direct Anthropic API call (ANTHROPIC_API_KEY)
    └─► Codex CLI: subprocess runCommand('codex', ['--print', prompt])
    ▼
eventBus.broadcast('task.status_changed')
    │
    ▼
SSE → Browser (task-board-panel.tsx updates live)
```

### Key Data Flows

1. **Org scan on startup:** `getOrgSnapshot()` called from `/api/org` routes — scans filesystem, writes all agents/teams/departments, enriches agent config blobs. Result cached in-process with `invalidateOrgSnapshot()` for forced refresh.

2. **Skills import triggered after org scan:** `importAgentSkillRoots()` runs after `scanFilesystemOrg()` completes — reads each agent's `workspace_path/skills/`, upserts into `skills` table with `source='agent-{name}'`. Existing `syncSkillsFromDisk()` is not called for these agent-scoped roots to avoid source-key collisions.

3. **Task dispatch runtime selection:** `dispatchTask()` reads `agent.config.preferredRuntime` (set during org scan from AGENT.md `runtime:` field). Falls through: openclaw gateway check → codex CLI check → direct Claude API. Never fails silently — logs and surfaces the active dispatch path.

4. **Hierarchical delegation — lead agent breakdown:** Delegation engine calls the lead agent with a structured prompt asking it to break the task into sub-tasks. Response is parsed for a list of agent-name/task pairs. No LLM routing sophistication is needed for v1.1 — the lead agent does the breakdown, Mission Control handles the dispatch.

5. **Real-time status rollup:** When a child task's status changes to `done`, a DB trigger or post-update hook checks if all siblings are done. If yes, parent task status is set to `done` and `task.status_changed` is broadcast. This can be a lightweight check in the existing task update API route — no background worker needed.

## Scaling Considerations

This is a single-operator tool. Scaling is not a concern. What matters is reliability of subprocess I/O.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single operator, ~100 agents | Current monolith is fine. SQLite is sufficient. |
| Automated delegation cycles | Subprocess timeouts must be generous (120s+) and spawn history must capture failures |
| Long-running Codex/Claude sessions | Use `spawn_history` table (already exists) to track state; don't block API request handlers |

### Scaling Priorities

1. **First bottleneck:** Synchronous subprocess calls in API route handlers. Claude Code `--print` and Codex `--print` are blocking. Mitigation: spawn to background job (pattern already used in `spawn/route.ts` via `callOpenClawGateway` which times out at 15s). For long tasks, adopt the fire-and-poll pattern from existing spawn route.

2. **Second bottleneck:** SQLite write contention if delegation creates many child tasks simultaneously. Mitigation: use `db.transaction()` to batch child task inserts (already done in `applyFilesystemOrgPersistence()`).

## Anti-Patterns

### Anti-Pattern 1: Adding New Columns to `agents` Table for Every Profile Field

**What people do:** Add `protocol_stack TEXT`, `deliverables TEXT`, `reporting_chain TEXT`, `preferred_runtime TEXT` as separate columns alongside `soul_content`.

**Why it's wrong:** The `agents` table already has 15+ columns. These fields are display-only and never queried in WHERE clauses. New columns require migrations that are hard to roll back.

**Do this instead:** Store all extended profile fields in `agents.config` JSON. Use `json_extract(config, '$.preferredRuntime')` only if a future migration needs it indexed. For v1.1, reading config in application code is sufficient.

### Anti-Pattern 2: Calling `syncSkillsFromDisk()` with the ZTech_Agents Root

**What people do:** Add the entire ZTech_Agents directory or each agent path to `getSkillRoots()` inside `skill-sync.ts`.

**Why it's wrong:** `skill-sync.ts` has a bidirectional delete-on-removal policy — it removes skills from the DB if the file disappears from disk. ZTech_Agents is read-only. The source key namespace (`user-agents`, `workspace`, etc.) is shared globally and would collide with per-agent source keys if mixed into the global scanner.

**Do this instead:** Import agent skills through `agent-skills-importer.ts` using a separate upsert-only path. Never auto-delete agent-scoped skills from the DB (they can be re-imported on next scan). Use `source = 'agent-{agentName}'` as the key.

### Anti-Pattern 3: Blocking API Route Handlers on Long Subprocess Calls

**What people do:** `await runCommand('codex', ['--print', longPrompt])` inside a Next.js API route handler, blocking until Codex finishes.

**Why it's wrong:** Next.js has a default response timeout. Long agent tasks (debugging, code generation) may take minutes. The browser will get a 504.

**Do this instead:** Mirror the existing `spawn/route.ts` pattern — create a `spawn_history` record, fire the subprocess in the background (`.then()` without `await`), return the spawn record ID immediately. The UI polls `/api/spawn/{id}` for status, or the SSE bus broadcasts completion.

### Anti-Pattern 4: Writing to ZTech_Agents Directory

**What people do:** Write `.team.json`, `.department.json`, or skill assignment files back into the ZTech_Agents tree from Mission Control.

**Why it's wrong:** The ZTech_Agents directory is read-only by project constraint. The existing `org-metadata.ts` `write*` functions write `.department.json` and `.team.json` but these are for the Mission Control internal state directory, not the agent definitions directory.

**Do this instead:** All operator-initiated overrides (lead assignment, runtime preference) are stored in the SQLite `agents.config` column or the `agent_team_assignments` table with `source = 'manual'`. Manual assignments take precedence over filesystem-derived data (already enforced by the UPSERT conflict policy in `applyFilesystemOrgPersistence()`).

## Integration Points

### Existing Components: What Is Modified vs. What Is New

| Component | Change Type | What Changes |
|-----------|-------------|--------------|
| `org-scanner.ts` | MODIFY | Call `parseFullAgentProfile()` inside `syncFilesystemAgentFromPath()`, pass result into `config` JSON. Call `importAgentSkillRoots()` after scan completes. |
| `task-dispatch.ts` | MODIFY | Add `dispatchToCodex()`, add `resolveAgentRuntime()` selector, extend main dispatch branch. Add `parent_task_id` propagation to spawned tasks. |
| `coordinator-routing.ts` | MODIFY | Add `resolveTeamLeadTarget()` — given a team external ID, return the lead agent's `openclawAgentId` for delegation routing. |
| `skill-sync.ts` | MODIFY (minor) | Add `agent-*` prefixed source keys to the `localSources` list used in the delete-safety check. |
| `migrations.ts` | MODIFY | Add migration for `parent_task_id` column + index on `tasks` table. |
| `event-bus.ts` | MODIFY | Add `task.delegated` and `task.subtask_completed` to `EventType` union. |
| `agent-profile-parser.ts` | NEW | Parse SOUL.md for soul content, USER.md for persona, AGENT.md for protocol stack (`A2A`, `ACP`, `MCP`, `ICP` lines), deliverables, reporting chain. Returns `AgentProfileExtension`. |
| `agent-skills-importer.ts` | NEW | Reads `workspace_path/skills/` for each filesystem agent, upserts into `skills` table with `source = 'agent-{name}'`. Called from `org-scanner.ts` post-scan. |
| `delegation-engine.ts` | NEW | Resolves hierarchy (dept lead → team lead → sub-agents), prompts lead agent for task breakdown, creates child tasks, dispatches them. |
| `src/app/api/agents/[id]/profile/` | NEW route | `GET /api/agents/:id/profile` — returns enriched agent profile from `config` JSON (parsed), including protocol stack, deliverables, skills count. |
| `src/app/api/agents/[id]/skills/` | NEW route | `GET /api/agents/:id/skills` — returns skills rows WHERE source = `'agent-{name}'`. |
| `src/app/api/tasks/delegate/` | NEW route | `POST /api/tasks/delegate { taskId, depth }` — calls delegation engine. |

### External Boundaries

| Boundary | Communication Pattern | Notes |
|----------|-----------------------|-------|
| Mission Control → OpenClaw Gateway | HTTP via `callOpenClawGateway()` subprocess | Already wired. Token from `getDetectedGatewayToken()`. |
| Mission Control → Claude Code CLI | `runCommand('claude', ['--print', prompt])` subprocess | Already wired in `task-dispatch.ts` via `callClaudeDirectly()` for direct API, but `--print` subprocess not yet added. |
| Mission Control → Codex CLI | `runCommand('codex', ['--approval-mode', 'full-auto', '--print', prompt])` subprocess | Not yet wired. `detectCodex()` in `agent-runtimes.ts` exists, but no dispatch path. |
| ZTech_Agents filesystem | `readFileSync()` via `org-scanner.ts` | Read-only. Never write. |
| SQLite | `better-sqlite3` synchronous calls | All writes in `db.transaction()` blocks. |
| Browser SSE clients | `eventBus.broadcast()` → `/api/events` SSE stream | Already handles `task.*` and `agent.*` events. New `task.delegated` event added. |

## Build Order (Feature Dependencies)

The four feature areas have clear dependencies:

```
1. Agent Profile Parser  ──► 2. Skills Import     ──► display in panels
        │
        ├──► 3. Runtime Gateway Connections  ──► 4. Task Delegation
```

**Recommended build order:**

1. **Agent profile enrichment** (profile parser + org scanner extension): Zero risk — extends existing config JSON without schema changes. All new code is additive. Unblocks everything.

2. **Skills import** (agent-skills-importer + skill-sync extension): Depends only on `workspace_path` being populated (done by org scanner). No schema change. Directly uses existing `skills` table.

3. **Multi-runtime dispatch** (codex path in task-dispatch + runtime selector): Requires profile parser to have written `preferredRuntime` into agent config. Needs Codex CLI installed separately — detection already exists.

4. **Hierarchical delegation** (delegation engine + parent_task_id migration + delegate API route): Depends on all three above. Needs profile enrichment to identify leads, skills import to be complete for context, and dispatch to work for all runtimes.

## Sources

- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/org-scanner.ts` (707 lines)
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/skill-sync.ts`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/task-dispatch.ts`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/agent-runtimes.ts`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/coordinator-routing.ts`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/migrations.ts`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/schema.sql`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/event-bus.ts`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/src/lib/openclaw-gateway.ts`
- Direct analysis of `/Users/rahmanwolied/Documents/Work/Ztech/mission-control/.planning/PROJECT.md`

---
*Architecture research for: v1.1 Agent Gateway Integration — ZTech Mission Control*
*Researched: 2026-04-01*
