# Project Research Summary

**Project:** ZTech Mission Control v1.1 — Agent Gateway Integration
**Domain:** AI agent orchestration dashboard — multi-runtime execution, agent lifecycle management, hierarchical task delegation
**Researched:** 2026-04-01
**Confidence:** HIGH

## Executive Summary

Mission Control v1.1 extends a well-established v1.0 codebase to close three specific gaps: the agent profile surface does not expose the rich metadata the org scanner already captures; skills stored in agent-local `skills/` subdirectories are invisible to the catalog; and the multi-runtime dispatch layer only works for OpenClaw, leaving Claude Code and Codex as detection-only runtimes with no actual dispatch path. The milestone also introduces a net-new capability — hierarchical task delegation — that requires a DB schema change and a new delegation engine. The recommended approach is to add exactly one new runtime dependency (`@anthropic-ai/claude-agent-sdk` v0.2.89), use subprocesses for Codex dispatch (matching the existing `runCommand()` pattern), and add all other capabilities through code changes to existing modules.

The correct build order is strict: agent profile enrichment must land first because it populates `workspace_path`, `preferredRuntime`, and `openclawId` normalization that every downstream phase depends on. Skills import and multi-runtime dispatch can proceed in parallel once profile enrichment is stable. Hierarchical delegation is last because it depends on agent identity being correct, all runtimes being dispatchable, and a DB migration (`parent_task_id` column) that cannot be written around. Attempting these in any other order produces integration failures that are expensive to unwind.

The primary risk area is schema design decisions made early in the milestone. Research identified a strong temptation to store new metadata fields in the `agents.config` JSON blob rather than as schema columns, to link sub-tasks via `metadata` JSON rather than a proper `parent_task_id` column, and to use display names as runtime identifiers without normalization. All three shortcuts produce silent failures that are hard to debug and expensive to recover from. Prevention requires explicit migrations before any feature code is written, not after.

---

## Key Findings

### Recommended Stack

The existing stack (Next.js 16, React 19, TypeScript 5, better-sqlite3, Tailwind 3, Zustand, pnpm) requires exactly one new runtime dependency. `@anthropic-ai/claude-agent-sdk` v0.2.89 provides structured message streaming, session lifecycle management, permission mode control, and abort support that raw `child_process` subprocess calls cannot replicate. Its `zod@^4.0.0` peer dependency is already satisfied by the project's `zod@^4.3.6`. All other v1.1 capabilities — skills import from agent directories, Codex dispatch, real-time status tracking, and the task hierarchy DB model — are code changes, not library additions.

**Core technologies:**
- `@anthropic-ai/claude-agent-sdk@^0.2.89`: Programmatic Claude Code session spawn and task dispatch — sanctioned programmatic interface with structured output, cannot be replaced by CLI subprocess for multi-turn sessions
- `better-sqlite3` (existing): Synchronous SQLite writes — all delegation batch inserts must use `db.transaction()` to avoid `SQLITE_BUSY` under parallel sub-task creation
- `runCommand()` in `src/lib/command.ts` (existing): Subprocess execution for Codex CLI dispatch — reuses timeout, streaming, and env configuration already tested in production

### Expected Features

Research identified six v1.1 must-have features, five should-have features, and a clear list of anti-features that would cause harm if added.

**Must have (table stakes):**
- Rich agent profile API + UI — org scanner already captures skills, KPIs, org-path, protocol stack; users expect to see it rendered, not raw config JSON
- Agent `skills/` subdirectory import — ZTech_Agents convention requires per-agent skill catalogs; currently invisible to the skills system
- Hierarchical task model (DB + API) — `parent_task_id` column + migration must precede all delegation logic; no workaround via metadata JSON
- Lead delegation UI — core orchestration value of the milestone; team leads need a structured breakdown surface
- Multi-runtime spawn (Claude Code + Codex) — PROJECT.md requirement; dispatch currently hardcoded to OpenClaw only
- Runtime status on agent cards — operator must know runtime health before delegating; detection exists, UI surface does not

**Should have (competitive, v1.1 patches):**
- Skills-gated agent suggestions — best-fit routing during task creation based on skill overlap
- Protocol stack display per agent — A2A/ACP/MCP/ICP badges in profile panels
- Subtask status rollup — parent task status derived from child task completion
- Skill-to-agent linking — visual bridge between AGENT.md inline skill names and installed SKILL.md definitions

**Defer (v2+):**
- Cross-department task routing — single-department flows must be stable first
- Task delegation audit trail / chain of custody view — needs production delegation data to design correctly
- Runtime health alerts — requires stateful monitoring beyond current polling model

**Anti-features (do not build):**
- Auto-decompose tasks using LLM at create time — the lead *agent* does decomposition; Mission Control provides the surface, not the intelligence
- Write back to ZTech_Agents directory — source-of-truth is version-controlled; dashboard writes risk merge conflicts and bypass Git review
- Full SKILL.md editor inside the dashboard — skills need version control and review before deployment

### Architecture Approach

The architecture is additive: three new `src/lib/` modules (`agent-profile-parser.ts`, `agent-skills-importer.ts`, `delegation-engine.ts`) and three new API route subtrees (`/api/agents/[id]/profile`, `/api/agents/[id]/skills`, `/api/tasks/delegate`). Existing modules (`org-scanner.ts`, `task-dispatch.ts`, `coordinator-routing.ts`, `skill-sync.ts`, `migrations.ts`, `event-bus.ts`) require targeted modifications. The data layer needs one migration: `parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE` with an index. All external runtime communication is via subprocess (`runCommand()`) for Codex and via the Claude Agent SDK for Claude Code; the existing OpenClaw gateway path is unchanged.

**Major components:**
1. `agent-profile-parser.ts` (NEW) — Parses SOUL.md, USER.md, and protocol fields from agent directory; called by org-scanner during sync; returns `AgentProfileExtension` merged into `agents.config` JSON
2. `agent-skills-importer.ts` (NEW) — Reads `workspace_path/skills/` for each filesystem agent; upserts to `skills` table with `source='agent-{name}'`; called post-scan; isolated from global `syncSkillsFromDisk()` to avoid delete-on-removal policy collision
3. `delegation-engine.ts` (NEW) — Resolves hierarchy (dept lead → team lead → sub-agents), prompts lead agent for task breakdown via Claude Agent SDK, creates child tasks atomically in a single transaction, dispatches each via runtime-appropriate path

### Critical Pitfalls

1. **Metadata fields in `agents.config` JSON blob instead of schema columns** — Add explicit schema migration for `protocol_stack`, `kpis`, `deliverables` as real columns before writing any parser changes; never let display/filter fields live only in JSON
2. **Sub-tasks linked via `metadata` JSON instead of `parent_task_id` column** — Add the DB migration as the very first step of the delegation phase; never use `JSON.parse(task.metadata).parent_id` for hierarchy queries; `ON DELETE CASCADE` is essential
3. **Agent name mismatch between filesystem display name and runtime ID** — Derive and store `openclawId = normalizeOpenClawId(parsedName)` in `config` at import time inside `ensureFilesystemAgent()`; never let dispatch be the first normalization point
4. **Blocking filesystem scans on the Next.js request thread** — Two-pass scan: async `fs.promises.readFile` with concurrency cap for file I/O, then single synchronous `db.transaction()` for DB writes; breaks at ~100 agents with 4 files each
5. **Skills import source key collision** — Use namespaced source keys (`org-agent:<agent-name>`); never reuse `user-agents`, `openclaw`, or other existing source strings; separate upsert-only import path from global `syncSkillsFromDisk()`

---

## Implications for Roadmap

Based on research, the build order is strictly constrained by data dependencies. The suggested phase structure reflects those constraints.

### Phase 1: Agent Profile Enrichment

**Rationale:** Everything downstream depends on accurate agent metadata. `preferredRuntime` in `agent.config` drives dispatch routing. `openclawId` normalization prevents silent dispatch failures. `workspace_path` is required by the skills importer. This phase is zero-risk (purely additive to config JSON or to new schema columns) and unblocks all subsequent phases.

**Delivers:** Enriched agent profiles with skills, KPIs, org-path, protocol stack, and runtime preference; normalized `openclawId` at import time; agent detail panel renders structured fields instead of raw JSON.

**Addresses features from FEATURES.md:** Rich agent profile API + UI, runtime status on agent cards, protocol stack display.

**Avoids:** Pitfall 1 (metadata in JSON blob), Pitfall 7 (agent name mismatch), Pitfall 6 (blocking scans) — all three must be addressed before writing any downstream code.

### Phase 2: Skills Import from Agent Directories

**Rationale:** Depends only on Phase 1 completing so `workspace_path` is reliably populated. Does not require the task hierarchy schema or dispatch changes. Can be developed and shipped independently to validate the skills catalog integration before delegation is added.

**Delivers:** SKILL.md files from each agent's `skills/` subdirectory imported to the global skills catalog with namespaced source keys; skills panel shows per-agent skills linked to catalog entries.

**Addresses features from FEATURES.md:** Agent `skills/` subdirectory import, skill-to-agent linking.

**Avoids:** Pitfall 3 (skills source key collision) — `org-agent:<name>` namespace isolation from global skill sync.

### Phase 3: Multi-Runtime Execution Gateway

**Rationale:** Depends on Phase 1 (needs `preferredRuntime` in agent config to route correctly) but independent of Phase 2. The normalized adapter pattern must be defined before any individual runtime adapter is written — prevents the status-model fragmentation pitfall.

**Delivers:** Claude Code dispatch via `@anthropic-ai/claude-agent-sdk`; Codex dispatch via `runCommand('codex', ['--approval-mode', 'full-auto', '--print'])` subprocess; unified `AgentResponse` adapter normalizing output from all three runtimes; non-null `sessionId` tracking for all dispatched tasks; fire-and-poll pattern for long-running tasks (mirroring existing `spawn/route.ts`).

**Addresses features from FEATURES.md:** Multi-runtime spawn (Claude Code + Codex), runtime status on agent cards.

**Avoids:** Pitfall 4 (no unified status model) — define the normalized `{ text, sessionId, status }` contract first; Anti-Pattern 3 (blocking API route handlers).

### Phase 4: Hierarchical Task Delegation

**Rationale:** Depends on all three preceding phases. Requires agent identity to be correct (Phase 1), all runtimes to be dispatchable (Phase 3), and skills context for lead agents to exist (Phase 2). The DB migration (`parent_task_id`) must be the first commit of this phase.

**Delivers:** `parent_task_id` column + index migration; `delegation-engine.ts` with batch-insert atomicity; `POST /api/tasks/delegate` endpoint; lead delegation UI with subtask breakdown form; subtask status rollup to parent; `task.delegated` and `task.subtask_completed` SSE events.

**Addresses features from FEATURES.md:** Hierarchical task model (DB + API), lead delegation UI, subtask status rollup.

**Avoids:** Pitfall 5 (orphaned sub-tasks), Pitfall 8 (SQLite contention) — batch all sub-task inserts in one transaction; `ON DELETE CASCADE` for clean parent cancellation.

### Phase Ordering Rationale

- **Phases must not be reordered:** Phase 1 writes `workspace_path`, `preferredRuntime`, and `openclawId` that Phases 2, 3, and 4 all read. Starting Phase 3 without Phase 1 means dispatch routing falls through to the `'fallback'` path and produces orphan gateway sessions.
- **Phases 2 and 3 can be developed in parallel** once Phase 1 is merged — they have no dependency on each other.
- **Phase 4 is a hard gate:** The `parent_task_id` migration cannot be added to an existing delegation flow that already uses `metadata` JSON — it must come first, before any delegation API code is written.
- **Pitfall prevention is phase-native, not a separate cleanup phase:** Schema migrations, source key namespacing, and name normalization each belong to the phase that introduces the relevant feature, not to a later "polish" phase.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Multi-Runtime):** Claude Agent SDK `query()` streaming integration with Next.js App Router SSE pattern needs a proof-of-concept spike; SDK is new (v0.2.89) and `unstable_v2_*` session APIs should be avoided. Codex `--print` flag behavior under `0.118.0` needs verification against actual CLI output.
- **Phase 4 (Delegation):** Lead agent prompt design for structured task decomposition using `options.outputFormat: { type: 'json_schema' }` from the Claude Agent SDK needs iteration; decomposition quality is LLM-dependent.

Phases with standard, well-documented patterns (skip deep research):
- **Phase 1 (Profile Enrichment):** All patterns are additive extensions to existing `org-scanner.ts` logic; no novel integration needed.
- **Phase 2 (Skills Import):** Directly mirrors `skill-sync.ts` patterns; only the source key namespace is new.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | One new dependency (`@anthropic-ai/claude-agent-sdk`) verified on npm at v0.2.89; all other capabilities are code changes to audited existing modules |
| Features | HIGH | Based on direct codebase audit of v1.0 + PROJECT.md requirements; no speculation about unknown user needs |
| Architecture | HIGH | Based on direct analysis of 10+ source files; component boundaries follow patterns already established in codebase |
| Pitfalls | HIGH | Each pitfall identified via direct inspection of existing code patterns, not inferred from general domain knowledge |

**Overall confidence:** HIGH

### Gaps to Address

- **Codex `--print` flag in v0.118.0:** The subprocess dispatch approach is confirmed as the right pattern, but the exact CLI flag for non-interactive output mode (`--print` vs `--non-interactive -q`) needs verification against the installed CLI version before Phase 3 ships.
- **Claude Agent SDK V2 session API:** Explicitly marked `unstable_v2_*` in official docs — use only the stable `query()` API in Phase 3; do not use `listSessions()` or `options.resume` until V2 stabilizes.
- **Lead agent prompt design:** The structured decomposition prompt that instructs a lead agent to break down a task into sub-tasks with JSON output schema needs validation against real ZTech_Agents lead agents before Phase 4 is specced in detail.
- **`p-limit` availability:** The two-pass async scan refactor in Phase 1 assumes a concurrency-limiting utility. Verify whether `p-limit` is already in `package.json` or if it needs to be added.

---

## Sources

### Primary (HIGH confidence)

- Claude Agent SDK TypeScript reference: https://platform.claude.com/docs/en/agent-sdk/typescript
- `@anthropic-ai/claude-agent-sdk` npm (v0.2.89): https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- Direct codebase analysis: `src/lib/org-scanner.ts`, `skill-sync.ts`, `task-dispatch.ts`, `agent-runtimes.ts`, `coordinator-routing.ts`, `migrations.ts`, `schema.sql`, `event-bus.ts`, `openclaw-gateway.ts`

### Secondary (MEDIUM confidence)

- `@openai/codex` npm (v0.118.0): https://www.npmjs.com/package/@openai/codex — Codex CLI dispatch pattern; `--print` flag behavior needs live verification
- AI Agent Orchestration in 2026 — https://kanerika.com/blogs/ai-agent-orchestration/
- Multi-Agent Orchestration Patterns — https://fast.io/resources/multi-agent-orchestration-patterns/
- Azure Architecture Center: AI Agent Design Patterns — https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns

### Tertiary (LOW confidence)

- Codex SDK class-based API — `@openai/codex` programmatic class API is documented but version stability is not guaranteed; subprocess approach preferred for v1.1

---

*Research completed: 2026-04-01*
*Ready for roadmap: yes*
