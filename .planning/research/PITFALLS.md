# Pitfalls Research

**Domain:** Agent gateway integration — metadata ingestion, multi-runtime execution, hierarchical task delegation
**Researched:** 2026-04-01
**Confidence:** HIGH (based on direct codebase analysis of existing implementations)

---

## Critical Pitfalls

### Pitfall 1: Metadata Parsing Silently Discards Rich Fields

**What goes wrong:**
The existing `parseAgentMetadata()` in `org-scanner.ts` extracts `name`, `role`, `skills`, `kpis`, and basic org fields, then stores everything extra into `agents.config` as opaque JSON under `folderOrg`. When new metadata fields are added (e.g., `protocol_stack`, `dependencies`, `deliverables`, `reporting_chain` from IDENTITY.md and AGENT.md), they either fall through to the catch-all JSON blob or are silently dropped. The UI then cannot query or filter on them because they are not first-class DB columns.

**Why it happens:**
The scanner was designed to get org structure working first. The `config` column is a JSON escape hatch for anything not worth schema-ing at the time. As more metadata is parsed and the UI wants to display it (protocol stack badges, dependency graphs, KPI views), developers reach into `config` with ad-hoc JSON path queries. This proliferates unpredictably.

**How to avoid:**
Add an explicit schema migration that adds dedicated columns for the fields v1.1 requires before writing any parser changes. Specifically: `protocol_stack TEXT` (JSON array), `dependencies TEXT` (JSON array), `deliverables TEXT` (JSON array), `kpis TEXT` (JSON array already tracked in config — promote it). Parser changes must target these columns, not `config`. Review `config` reads in UI components before shipping to ensure nothing silently breaks.

**Warning signs:**
- Any new UI feature that calls `JSON.parse(agent.config)` and accesses a nested key that is not in the schema
- Agent profile panels that show empty fields when the markdown files clearly contain the data
- `parseAgentMetadata()` growing a `rest: Record<string, unknown>` return field

**Phase to address:**
Phase that handles agent profile enrichment (metadata ingestion). Schema migration must land before any parser work touches the DB.

---

### Pitfall 2: org-scanner Cache Hides Fresh Metadata

**What goes wrong:**
`getOrgSnapshot()` uses an in-memory `Map<number, OrgSnapshot>` stored on `globalThis`. The cache has no TTL — it persists until `invalidateOrgSnapshot()` is called explicitly or the Node process restarts. If an agent's AGENT.md is edited on disk, a subsequent API request to fetch that agent's enriched profile will return stale data from the in-memory cache. The skills import, protocol stack, and deliverables will not reflect the update until someone manually triggers a re-scan.

**Why it happens:**
The original cache was designed for org structure (departments and teams), which changes infrequently. Agent metadata (skills, protocols, KPIs) changes more frequently as agents are tuned. The invalidation path (`invalidateOrgSnapshot`) is called from the org re-scan API route but not from the metadata profile API route being added.

**How to avoid:**
Content-hash the per-agent metadata files at scan time (already done for `contentHash` in `ensureFilesystemAgent`). On every agent profile fetch, compare the stored `content_hash` to a fresh hash of the file. If they differ, invalidate the cache for that agent only and re-scan. Alternatively, add a file watcher (the codebase already has `org-watcher.ts`) that invalidates on `AGENT.md` / `IDENTITY.md` changes.

**Warning signs:**
- Profile page shows outdated skills after editing AGENT.md
- `scannedAt` timestamp in the cache is hours old but the UI shows no staleness indicator
- Test that writes to AGENT.md and immediately fetches the profile fails intermittently

**Phase to address:**
Phase that adds the metadata profile enrichment API endpoints.

---

### Pitfall 3: Skills Import Collides with Existing Skill Registry Sources

**What goes wrong:**
The skills system already tracks skills by `(source, name)` unique constraint in the `skills` table. Existing sources are `user-agents`, `user-codex`, `project-agents`, `project-codex`, `openclaw`, `workspace`. The ZTech_Agents skills directories (`Agent_Name/skills/`) do not map to any of these source keys. If the importer uses an ad-hoc source string like `filesystem` or `ztech`, it will create orphan rows. If it collides with an existing source string (e.g., `user-agents`), it will corrupt data for agents whose skills were already indexed from `~/.agents/skills`.

**Why it happens:**
`skill-sync.ts` and `skill-registry.ts` were designed for a different agent skill model (global user/project directories, not per-agent subdirectories inside ZTech_Agents). The source namespace was never designed for hierarchical org-level skill sets.

**How to avoid:**
Use a namespaced source key format: `org-agent:<agent-name>` or `org:<department>/<team>/<agent>`. This is unique, queryable, and will not collide with existing source strings. Add a DB migration that adds an index on `source` if not already present. When scanning agent skills, do not call `syncSkillsFromDisk()` (which only knows the five hardcoded roots) — write a dedicated `syncOrgAgentSkills()` that operates on `AGENTS_DIR`-relative paths only.

**Warning signs:**
- Skills panel shows duplicate entries for the same skill
- A `skill-sync` run removes skills that were imported via org scanner
- The skills table grows disproportionately large relative to agent count

**Phase to address:**
Phase that handles skills import from agent directories. Must be isolated from the general skill sync.

---

### Pitfall 4: Multi-Runtime Dispatch Has No Unified Status Model

**What goes wrong:**
The three runtimes (Claude Code CLI, OpenClaw gateway, Codex CLI) each report task status differently. Claude Code uses JSONL streaming output with no persistent session tracking by default. OpenClaw returns `{ payloads: [{ text }], sessionId }`. Codex returns its own JSON schema. The existing `parseAgentResponse()` in `task-dispatch.ts` handles OpenClaw and a fallback, but Claude Code spawned via CLI subprocess produces JSONL, not a single JSON object. When a task is dispatched to a Claude Code agent, the caller gets back a raw stdout blob that `parseAgentResponse()` cannot handle, resulting in `sessionId: null` and no way to track ongoing work.

**Why it happens:**
The gateway was initially OpenClaw-only. Claude Code and Codex were added as `RuntimeId` entries in `agent-runtimes.ts` but only for detection/installation purposes — the actual dispatch path in `task-dispatch.ts` still routes everything through `callOpenClawGateway` or the direct Anthropic API. There is no dispatch adapter for Claude Code CLI sessions or Codex CLI.

**How to avoid:**
Implement the adapter pattern that already exists in `src/lib/adapters/`. The `claude-sdk.ts` and `autogen.ts` adapters show the correct shape. For each runtime, create a dedicated dispatch adapter that normalizes the response into `{ text, sessionId, status }`. The gateway layer calls the appropriate adapter based on the agent's `config.runtime` field. Never let raw subprocess stdout leak into the status tracking layer.

**Warning signs:**
- `sessionId` is null for Claude Code or Codex dispatched tasks
- Task status remains `in_progress` indefinitely after dispatch
- `parseAgentResponse()` returns `{ text: null, sessionId: null }` for a task that visually appeared to run

**Phase to address:**
Phase that adds multi-runtime execution. Must define the normalized response contract before any individual runtime adapter is written.

---

### Pitfall 5: Hierarchical Delegation Creates Orphaned Sub-Tasks

**What goes wrong:**
The flow is: user assigns task to department lead → lead breaks it into sub-tasks → sub-tasks assigned to team leads → team leads assign to sub-agents. Each delegation step creates a new task row. If the parent task is cancelled, updated, or reassigned, the children are not automatically updated. The tasks table has `metadata TEXT` (JSON) but no `parent_task_id` column. Sub-tasks are linked only via metadata JSON keys (`parent_id`, `parentTaskId`) set ad-hoc by whatever creates them. When the UI filters by status or agent, it cannot reconstruct the hierarchy and shows orphaned sub-tasks that appear as standalone work.

**Why it happens:**
The task model was designed as a flat kanban. Delegation hierarchy was not in the original design. Developers will naturally add `parent_id` to task metadata (JSON) rather than schema because it is easier. This breaks every query that needs to traverse the hierarchy.

**How to avoid:**
Add `parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE` as a proper schema column in a DB migration before any delegation logic is written. Add an index on `parent_task_id`. All queries for sub-tasks, hierarchy views, and cascade operations use this column, not `metadata`. The cascade delete ensures that cancelling a parent automatically cancels all sub-tasks.

**Warning signs:**
- Any code that does `JSON.parse(task.metadata).parent_id` to find a task's parent
- The task board shows items with no description or unrecognizable titles (orphaned sub-tasks from a cancelled delegation)
- Counts in the dashboard stats do not match what the kanban shows because sub-tasks are counted separately

**Phase to address:**
Phase that adds hierarchical delegation. Schema migration must precede all delegation logic.

---

### Pitfall 6: Blocking Filesystem Scans on the Next.js Request Thread

**What goes wrong:**
`scanFilesystemOrg()` runs `readdirSync`, `readFileSync`, and `statSync` synchronously within a `db.transaction()` for potentially hundreds of agents across ~70 teams and 14 departments. In the existing code this runs on the request thread (Next.js API route). With plain org structure (just directory names), the I/O is fast. With full metadata parsing (reading AGENT.md, IDENTITY.md, SOUL.md, USER.md per agent — 4 file reads × ~300 agents = ~1200 synchronous reads), the scan can block the event loop for hundreds of milliseconds, causing all concurrent requests to the Next.js server to stall.

**Why it happens:**
`better-sqlite3` is synchronous by design — mixing it with async I/O is awkward. The existing scanner used synchronous file reads to stay in the same transaction scope. This was acceptable for the original small payload. Deep metadata parsing quadruples the I/O without changing the synchronous model.

**How to avoid:**
Read the metadata files before entering the DB transaction, not inside it. Structure the scan as two passes: (1) async file discovery that reads all markdown content in parallel using `fs.promises.readFile` with a concurrency cap (e.g., `p-limit(20)`), then (2) a single synchronous DB transaction that upserts the already-in-memory data. This keeps the DB transaction short and avoids blocking the event loop on I/O.

**Warning signs:**
- API routes take >200ms on endpoints that do not touch the scanner
- The health check endpoint (`/api/status`) times out during a scan cycle
- Node.js event loop lag metrics spike coincidentally with scan triggers

**Phase to address:**
Phase that adds deep metadata parsing. Refactor the scan internals before adding more file reads.

---

### Pitfall 7: Agent Name Mismatch Between Filesystem and Runtime Identity

**What goes wrong:**
The org scanner derives agent names from directory names and markdown headings (`Agent_Name/` → parsed name). The OpenClaw gateway identifies agents by `openclawId` (usually a kebab-case slug). Claude Code identifies agents by their agent file name or session key. When a task is dispatched, `resolveGatewayAgentId()` in `task-dispatch.ts` falls back to `agent_name` (the display name from the DB) if `agent.config.openclawId` is not set. If the display name has spaces or mixed case (`Atlas Coordinator`) while the gateway expects `atlas-coordinator`, the dispatch silently fails — the gateway creates a new session under the wrong name rather than routing to the existing persistent agent.

**Why it happens:**
The org scanner stores whatever name it parsed from the markdown. The runtime gateway normalization (`normalizeOpenClawId`) lowercases and replaces spaces, but only at dispatch time, not at import time. There is no reconciliation step when a new filesystem agent is persisted to the DB.

**How to avoid:**
When `ensureFilesystemAgent()` persists a new agent, derive and store `openclawId` in `config` immediately: `normalizeOpenClawId(parsedName)`. Never let dispatch be the first place this normalization happens. Add a validation step in the metadata import phase that checks that the derived `openclawId` matches an existing gateway session (if any) and warns if it does not.

**Warning signs:**
- Tasks dispatched to filesystem-sourced agents come back with `resolvedBy: 'fallback'` instead of `'direct'` or `'configured'`
- Gateway session list shows multiple sessions for what should be one agent (e.g., `atlas-coordinator` and `Atlas Coordinator`)
- Tasks never transition from `in_progress` because the routed-to agent does not know it has tasks

**Phase to address:**
Phase that adds metadata ingestion (agent profile enrichment). Fix normalization at import time.

---

### Pitfall 8: SQLite WAL Mode Contention During Parallel Delegation Writes

**What goes wrong:**
Hierarchical delegation at scale means one incoming user task generates a burst of DB writes: parent task insert, N sub-task inserts, N agent assignment updates, N activity log entries, N event bus emissions. In SQLite with WAL mode, concurrent writes from multiple API requests serialise at the WAL writer lock. Under a large agent fleet (70+ teams, hundreds of agents), a delegating department lead that creates 10 sub-tasks simultaneously will cause 10 concurrent writers to queue. The `better-sqlite3` BUSY_TIMEOUT default may cause some to fail with SQLITE_BUSY rather than wait.

**Why it happens:**
SQLite is a single-writer database. The existing codebase uses it well for low-concurrency reads/writes. Hierarchical delegation introduces the first genuinely write-heavy burst pattern.

**How to avoid:**
Ensure `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` (already likely set — verify in `db.ts`). More importantly, batch all sub-task inserts from a single delegation into one transaction rather than separate API calls. The delegation endpoint should accept the full sub-task list and insert all of them atomically. This reduces N concurrent writers to 1.

**Warning signs:**
- SQLITE_BUSY errors in logs coinciding with delegation operations
- Partial delegation state — parent task shows `in_progress` but only 3 of 10 expected sub-tasks exist
- E2E tests for delegation flake under concurrent load

**Phase to address:**
Phase that implements hierarchical delegation. Write the batch-insert delegation API from the start.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store all new metadata fields in `agents.config` JSON instead of schema columns | No migration needed | Cannot query/filter/index; UI requires custom JSON parsing everywhere | Never — schema columns are necessary for any field the UI displays or filters on |
| Use display name as runtime agent ID without normalization | Simpler import code | Silent dispatch failures; duplicate gateway sessions | Never |
| Spawn all metadata file reads synchronously inside DB transaction | Stays in existing scanner pattern | Blocks event loop at 300+ agents; visible latency to all users | Never for production — acceptable only in initial spike/prototype |
| Link sub-tasks via `metadata` JSON instead of `parent_task_id` column | No migration needed | Entire delegation hierarchy becomes unqueryable | Never — the hierarchy IS the core feature |
| Hardcode runtime-specific response parsing in the dispatch layer | Gets one runtime working quickly | Each new runtime requires invasive changes to dispatch; impossible to unit test in isolation | Only for an initial spike, then refactor behind the adapter interface |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenClaw gateway | Calling `callOpenClawGateway` with `method: 'agent.run'` and expecting a synchronous completion | OpenClaw agent sessions are persistent — use `session.send` and poll for response via session key, not a single synchronous call |
| Claude Code CLI | Treating `claude --print` output as a single JSON blob | Claude Code CLI outputs JSONL (one JSON object per line); use a streaming parser or collect all lines before parsing |
| Codex CLI | Using `codex run --json` and expecting the same schema as OpenClaw | Codex JSON output schema is different; wrap it in a dedicated adapter that normalizes to the internal `AgentResponse` type |
| ZTech_Agents filesystem | Assuming all agents have AGENT.md | Some agents may only have IDENTITY.md or SOUL.md; the parser must handle all partial-metadata cases gracefully |
| org-scanner + file watcher | Calling `getOrgSnapshot({ force: true })` inside a file-change event handler | This can trigger multiple concurrent full scans; debounce file-change events with at least 500ms before re-scanning |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous metadata file reads inside DB transaction | API latency spikes to 500ms+ during background scan; event loop lag visible in logs | Two-pass scan: async file reads first, then synchronous DB batch | Breaks at ~100 agents with 4 files each (~400 synchronous reads per scan cycle) |
| Full org re-scan triggered on every profile API request | Dashboard feels sluggish; every page load is slow | Cache with content-hash invalidation; only re-scan agents whose file hash changed | Breaks immediately at any agent count if re-scan is called on each request |
| Delegation creates sub-tasks via N separate API calls (one per sub-agent) | Burst of SQLITE_BUSY errors; partial delegation state | Batch delegation endpoint that inserts all sub-tasks in a single transaction | Breaks at 5+ concurrent sub-task insertions under any load |
| Skills import reads all skills/ subdirectories on every agent page load | Skills panel slow to open; high file descriptor usage | One-time import on agent sync; cache result with content hash; only re-read changed files | Breaks at 50+ skills per agent |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting metadata field values from AGENT.md without sanitization when constructing task prompts | Prompt injection — a malicious AGENT.md could inject instructions into delegation prompts | Apply the existing `injection-guard.ts` logic to all metadata fields used in prompt construction |
| Using agent's `workspace_path` directly in file reads without path validation | Path traversal — a crafted `workspace_path` could read files outside ZTech_Agents | Verify `workspace_path` is within `config.agentsDir` using `path.resolve` comparison, similar to the `isSafeRelativeDir` check in `org-metadata.ts` |
| Delegating tasks from team lead to sub-agents without verifying sub-agent identity | A compromised or spoofed agent definition file could receive delegation from the lead | Only delegate to agents whose `workspace_path` was sourced from the verified `AGENTS_DIR`; refuse delegation to `source: 'local'` or manually-created agents unless explicitly allowed |
| Exposing full SOUL.md content in agent profile API response | SOUL.md may contain sensitive operational prompts; exposing them externally is a data leak | Treat `soul_content` as internal; return only role, skills, and metadata to the profile API; keep soul behind an auth-gated admin endpoint |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing "offline" status for filesystem agents immediately after metadata import | User sees all their agents as offline, appears broken | Show "available" (not yet connected to runtime) as a distinct status distinct from "offline" (previously connected, now gone) |
| Delegating to a team lead without showing the breakdown plan | User delegates a task and has no visibility into how it was decomposed | After delegation, show a live delegation tree — parent task + all generated sub-tasks with their assigned sub-agents |
| Using runtime-specific terminology ("session key", "openclawId") in the delegation UI | Operators are confused by internal identifiers leaking into the task board | All delegation UI uses org names (Agent Name, Team Name, Department); runtime IDs are internal only |
| Not distinguishing between "task dispatched" and "task received by agent" | User thinks task is done when it was only dispatched | Two-step status: `dispatched` (prompt sent to runtime) → `acknowledged` (runtime confirmed receipt) → `in_progress` (agent started working) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Metadata import:** Verify all parsed fields land in schema columns, not just `config` JSON — check with a direct DB query `SELECT id, name, config FROM agents WHERE source='filesystem' LIMIT 5` and confirm `kpis`, `skills`, `protocol_stack` are not all in the JSON blob
- [ ] **Skills import:** Verify agent-level skills use a namespaced source key — query `SELECT DISTINCT source FROM skills` and confirm no collision with `user-agents` or `openclaw`
- [ ] **Multi-runtime dispatch:** Verify Claude Code and Codex tasks return a non-null `sessionId` after dispatch — a null `sessionId` means the response parser fell through to the fallback
- [ ] **Hierarchical delegation:** Verify `parent_task_id` is a real column, not just in `metadata` — run `PRAGMA table_info(tasks)` and confirm the column exists
- [ ] **Name normalization:** Verify that a filesystem agent with a display name containing spaces dispatches correctly — create agent "Test Agent", dispatch a task, confirm it routes to the right session and does not create a new orphan session
- [ ] **Cache invalidation:** Verify that editing AGENT.md and re-fetching the profile returns updated data within one scan cycle — not stale cached data
- [ ] **Status propagation:** Verify that cancelling a parent task cascades to all sub-tasks — confirm via DB query `SELECT status FROM tasks WHERE parent_task_id = <cancelled_id>`

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Metadata fields in config JSON instead of schema columns | HIGH | Write a data migration that reads existing `config` JSON and populates new columns; audit all UI code that reads `config`; update all write paths |
| Orphaned sub-tasks with no `parent_task_id` | MEDIUM | Write a one-time reconciliation query that reads `metadata.parent_id` and backfills `parent_task_id`; cannot recover sub-tasks whose parent was already deleted |
| Agent name mismatch causing dispatch failures | MEDIUM | Write a migration that re-derives `openclawId` for all filesystem agents; test each agent's dispatch with the new ID |
| Synchronous scan blocking event loop | LOW | Refactor to two-pass scan (async reads, then sync DB batch); no data loss, only implementation work |
| Skills source key collision | MEDIUM | Identify colliding rows by source+name, delete the incorrectly-sourced entries, re-run org skills import with correct namespaced source key |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Metadata parsing silently discards rich fields | Phase: Agent profile enrichment | Query DB after import; confirm `kpis`, `protocol_stack`, `deliverables` are populated as columns, not inside `config` |
| org-scanner cache hides fresh metadata | Phase: Agent profile enrichment | Edit AGENT.md for one agent, re-fetch profile via API, confirm update reflected within one scan cycle |
| Skills import collides with existing sources | Phase: Skills import from agent directories | Query `SELECT DISTINCT source FROM skills`; confirm no existing source key is reused |
| Multi-runtime dispatch has no unified status model | Phase: Multi-runtime execution gateway | Dispatch a task to a Claude Code agent and a Codex agent; confirm both return non-null `sessionId` |
| Hierarchical delegation creates orphaned sub-tasks | Phase: Hierarchical task delegation | Cancel a parent task; confirm all sub-tasks also cancelled; query `SELECT * FROM tasks WHERE parent_task_id = <id>` |
| Blocking filesystem scans on request thread | Phase: Agent profile enrichment | Measure API latency during a forced full re-scan; confirm event loop lag < 50ms |
| Agent name mismatch between filesystem and runtime | Phase: Agent profile enrichment | Dispatch task to agent named "Test Agent" with a space; confirm `resolvedBy` is not `'fallback'` |
| SQLite contention during parallel delegation writes | Phase: Hierarchical task delegation | Trigger a bulk delegation that creates 10+ sub-tasks; confirm no SQLITE_BUSY errors in logs; confirm all sub-tasks created atomically |

---

## Sources

- Direct analysis of `src/lib/org-scanner.ts` — identifies cache model, sync/blocking pattern, name parsing
- Direct analysis of `src/lib/task-dispatch.ts` — identifies single-runtime dispatch, response parsing gaps
- Direct analysis of `src/lib/coordinator-routing.ts` — identifies name normalization gap between display name and runtime ID
- Direct analysis of `src/lib/skill-sync.ts` and `src/lib/skill-registry.ts` — identifies source key namespace collision risk
- Direct analysis of `src/lib/agent-runtimes.ts` — confirms Claude Code / Codex are detection-only; no dispatch adapters exist
- Direct analysis of `src/lib/schema.sql` — confirms `parent_task_id` column does not exist; `metadata` is the only parent linkage field currently available
- Direct analysis of `src/lib/org-metadata.ts` — confirms `isSafeRelativeDir` pattern as the existing security boundary model
- Direct analysis of `src/lib/local-agent-sync.ts` — confirms dual-source (filesystem + local) pattern and disk-wins conflict resolution

---
*Pitfalls research for: ZTech Mission Control v1.1 — agent gateway integration*
*Researched: 2026-04-01*
