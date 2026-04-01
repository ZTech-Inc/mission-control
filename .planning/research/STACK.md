# Technology Stack

**Project:** ZTech Mission Control v1.1 — Agent Gateway Integration
**Researched:** 2026-04-01
**Scope:** Additions only — existing validated stack (Next.js 16, React 19, TypeScript 5, SQLite/better-sqlite3, Tailwind CSS 3, Zustand, pnpm) is NOT re-researched here.

---

## What Already Exists (Do NOT Re-Add)

The codebase already ships everything listed below. These are documented to prevent duplication during roadmap planning.

| Capability | Where It Lives |
|------------|---------------|
| Markdown file parsing (raw string read) | `src/lib/org-scanner.ts` — `safeRead()` + custom regex parsers for fields, lists, tables |
| Agent metadata ingestion (AGENT.md, IDENTITY.md, SOUL.md, USER.md) | `src/lib/org-scanner.ts` — `parseAgentMetadata()`, `syncFilesystemAgentFromPath()` |
| Skills disk scan and DB sync | `src/lib/skill-sync.ts` — `syncSkillsFromDisk()` scanning SKILL.md under 6 root paths |
| Skills registry search + install (ClawdHub, skills.sh, Awesome OpenClaw) | `src/lib/skill-registry.ts` |
| Runtime detection (openclaw, hermes, claude, codex) | `src/lib/agent-runtimes.ts` — `detectAllRuntimes()`, `detectRuntime()` |
| Runtime installation (local + docker) | `src/lib/agent-runtimes.ts` — `startInstall()` with background jobs |
| Task dispatch via OpenClaw gateway | `src/lib/task-dispatch.ts` + `src/lib/openclaw-gateway.ts` |
| Task routing / model classification | `src/lib/task-dispatch.ts` — `classifyTaskModel()` |
| Claude Code session scanning (read-only) | `src/lib/claude-sessions.ts`, `src/lib/claude-tasks.ts` |
| Codex session scanning | `src/lib/codex-sessions.ts` |
| SSE event bus | `src/lib/event-bus.ts` |
| PTY / terminal via node-pty | `src/lib/pty-manager.ts` |
| Agent config JSON stored in `agents.config` column | `src/lib/schema.sql`, `src/lib/org-scanner.ts` |
| react-markdown + remark-gfm | Already in `package.json` — `react-markdown@^10.1.0`, `remark-gfm@^4.0.1` |
| zod validation | Already in `package.json` — `zod@^4.3.6` |

**Conclusion for parsing/markdown:** No new markdown parsing library is needed. The custom regex parsers in `org-scanner.ts` already handle the AGENT.md/IDENTITY.md/SOUL.md/USER.md files. Adding `gray-matter` would be redundant unless YAML frontmatter blocks are discovered in the actual agent files — the current files use plain markdown with `Key: Value` patterns, not YAML front matter.

---

## New Additions Required

### 1. Claude Agent SDK — Programmatic Claude Code Session Dispatch

**Gap:** The current codebase can *detect* and *scan* existing Claude Code sessions (`claude-sessions.ts`, `claude-tasks.ts`) but cannot *spawn* new sessions or *send tasks* to running agents programmatically. The only dispatch path is through the OpenClaw gateway via `openclaw-gateway.ts`. Claude Code agents need their own dispatch channel.

**Library:** `@anthropic-ai/claude-agent-sdk`
**Version:** `^0.2.89` (latest as of 2026-04-01)
**Confidence:** HIGH — official Anthropic package, verified on npm

| Property | Value |
|----------|-------|
| Package | `@anthropic-ai/claude-agent-sdk` |
| Install | `pnpm add @anthropic-ai/claude-agent-sdk` |
| Node requirement | >= 18 (project already requires >= 22, satisfied) |
| Peer dependency | `zod@^4.0.0` (already in stack at `^4.3.6`) |
| TypeScript | Ships own types |
| Key API | `query({ prompt, options })` — async generator streaming messages |
| Session list | `listSessions({ dir, limit })` — discover existing Claude sessions |
| Session resume | `options.resume = sessionId` — continue a prior session |
| Working dir | `options.cwd` — scope session to agent's workspace path |
| Permission mode | `options.permissionMode: 'bypassPermissions'` for autonomous dispatch |
| Max turns | `options.maxTurns` — bound agent execution |

**Why this over `child_process` spawning `claude` directly:** The SDK provides structured message streaming (`SDKMessage` types), session lifecycle management, permission mode control, and abort/interrupt support. Direct `claude --print` subprocess calls (which `agent-runtimes.ts` does for version detection) cannot reliably stream structured output or handle multi-turn sessions. The SDK is the sanctioned programmatic interface.

**Integration point:** New `src/lib/claude-dispatch.ts` module. The existing `agent-runtimes.ts` handles install detection; the dispatch module is separate and uses the SDK's `query()` to fire tasks with `options.cwd` set to the agent's `workspace_path` from the DB.

---

### 2. Skills Directory Import from Agent `skills/` Subdirectories

**Gap:** `skill-sync.ts` scans standard skill roots (`~/.agents/skills`, `~/.codex/skills`, `~/.openclaw/skills`, etc.) but does NOT scan `skills/` subdirectories inside each agent's directory in the ZTech_Agents tree. Agent definitions like `ZTech_Agents/Dept/TEAM/Agent_Name/skills/` are invisible to the current sync.

**Library:** None needed — Node.js built-ins (`fs.readdirSync`, `fs.readFileSync`) are sufficient, matching the existing pattern in `skill-sync.ts` and `org-scanner.ts`.

**What is needed:** A code change, not a new library. `skill-sync.ts` needs a new root source type `'agent-local'` that is populated by walking the filesystem org tree (already available via `getOrgSnapshot()`) and collecting every `skills/` subdirectory found under agent directories. The `SKILL.md` detection and DB upsert logic can be reused verbatim.

**Integration point:** Extend `getSkillRoots()` in `src/lib/skill-sync.ts` to include agent-local skill paths, or add a new `syncAgentLocalSkills(agentsDir: string)` function called after `getOrgSnapshot()`.

---

### 3. Codex Programmatic Dispatch

**Gap:** Same as Claude Code — detection and session scanning exist, but no dispatch path exists.

**Library:** `@openai/codex`
**Version:** `^0.118.0` (latest as of 2026-04-01, installed globally per existing pattern)
**Confidence:** MEDIUM — official OpenAI package, but the programmatic SDK (`@openai/codex-sdk`, separate from the CLI) is documented but version/stability is uncertain

**Assessment:** The Codex CLI (`@openai/codex`) is the same package used for both CLI and SDK usage. The SDK exposes `Codex` class and `thread.run(prompt)` for programmatic dispatch. However, this is a CLI-first tool and the programmatic API surface is narrower than the Claude Agent SDK.

**Recommended approach:** Use `child_process.spawn('codex', ['--non-interactive', '-q', prompt])` with the working directory set to the agent's path. This is the same pattern used in `runCommand()` (`src/lib/command.ts`) which already abstracts subprocess execution with timeout, streaming, and env configuration. The CLI's `--non-interactive` flag runs the agent headlessly.

**Why NOT the SDK class approach for now:** The `@openai/codex-sdk` programmatic API is not yet a stable, separate package — it lives inside the `@openai/codex` package and the class-based API surface changes across versions. The subprocess approach is more stable and consistent with how `installCodexLocal()` and `detectCodex()` already work.

**No new dependency required.** Use existing `runCommand()` from `src/lib/command.ts`.

---

### 4. Real-Time Task Delegation Status Tracking

**Gap:** The existing `task-dispatch.ts` dispatches tasks to the OpenClaw gateway synchronously and updates task status. There is no polling or streaming mechanism to watch a dispatched Claude Code or Codex process and update task status as it executes.

**Library:** No new library needed. The existing stack covers this:

| Mechanism | How |
|-----------|-----|
| SSE streaming back to dashboard | `src/lib/event-bus.ts` — existing `emit()` pattern, already used for task updates |
| Process stdout streaming | `runCommand()` in `src/lib/command.ts` — `onData` callback already supports streaming |
| DB task status updates | `better-sqlite3` synchronous writes, already used everywhere |
| Frontend polling / SSE consumption | `useServerEvents` hook in `src/lib/use-server-events.ts` — already live in UI |

**What is needed:** Wire `onData` from the dispatch subprocess into `eventBus.emit()` calls that update `task.status` in SQLite and push SSE events. This is plumbing, not a new library.

---

### 5. Hierarchical Task Delegation (Team Lead Decomposition)

**Gap:** No task decomposition or sub-task creation logic exists. When a user delegates a task to a department or team lead, the lead agent needs to break the task into sub-tasks and assign them to team members.

**Libraries:** None new. This feature is an LLM prompt engineering + data modeling concern, not a library gap.

**What is needed:**
- A DB migration adding a `parent_task_id` foreign key to the `tasks` table (self-referential for sub-task trees)
- A new API route (`POST /api/tasks/:id/delegate`) that dispatches the parent task to the assigned lead agent with a structured prompt instructing decomposition
- The lead agent (via Claude Agent SDK `query()`) responds with structured subtask JSON — enforced via `options.outputFormat` (JSON schema) in the SDK
- The API route parses the response and inserts child tasks with `parent_task_id = :id`

**SDK feature used:** `options.outputFormat: { type: 'json_schema', schema: subtaskSchema }` from the Claude Agent SDK for structured decomposition output.

---

## Revised Stack Summary

### Stack Additions

| Library | Version | Purpose | Install |
|---------|---------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | `^0.2.89` | Programmatic Claude Code session spawn + task dispatch | `pnpm add @anthropic-ai/claude-agent-sdk` |

### No Additions Required For

| Capability | Reason |
|------------|--------|
| Markdown parsing (AGENT.md etc.) | Already implemented in `org-scanner.ts` with custom regex |
| Skills import from agent dirs | Code change only — extend `skill-sync.ts` root sources |
| Codex dispatch | Use existing `runCommand()` subprocess pattern |
| Real-time status tracking | Wire existing `event-bus.ts` + `onData` callback |
| Task hierarchy DB | SQLite migration, no new ORM or library |
| `gray-matter` | Agent files use `Key: Value` patterns, not YAML frontmatter |
| `react-markdown` | Already at `^10.1.0` in `package.json` |
| `marked` | Not needed — `react-markdown` already handles rendering |
| `zod` | Already at `^4.3.6`, compatible with Claude Agent SDK peer dep |

### What Stays the Same

All existing stack (Next.js 16, React 19, TypeScript 5, better-sqlite3, Tailwind 3, Zustand, pnpm, node-pty, ws, react-markdown, recharts, zustand) remains unchanged. The milestone adds exactly one new runtime dependency.

---

## Integration Points with Existing Stack

### Claude Agent SDK + Next.js App Router

The `query()` function returns an async generator. In Next.js API routes (App Router), this is consumed in a server-side route handler (`src/app/api/...`). The SDK spawns a child Claude Code process, so the route runs server-side only — no client import needed. The route streams events through the existing SSE endpoint pattern.

**Constraint:** The SDK must run in a Node.js context, not in Edge runtime. All dispatch API routes must use `export const runtime = 'nodejs'` (or omit it, as Node.js is the default for App Router route handlers).

### Claude Agent SDK + SQLite

No conflict. The SDK is async; `better-sqlite3` is synchronous. In the dispatch flow:
1. SDK `query()` starts (async)
2. `onData` / message handlers fire synchronously into `better-sqlite3` writes
3. `eventBus.emit()` fires SSE to connected clients

### Claude Agent SDK + Zustand

No direct interaction. Zustand is client-side state. The SDK runs server-side. Status updates travel: SDK message → SQLite update → SSE event → client `useServerEvents` → Zustand store update.

### `options.cwd` = Agent's `workspace_path`

The `workspace_path` column on the `agents` table (set during filesystem org scan) is passed as `options.cwd` when dispatching a task via the SDK. This scopes the Claude Code session to the correct agent directory, giving the agent context about its own project/skill files.

---

## Installation

```bash
# Add the one new runtime dependency
pnpm add @anthropic-ai/claude-agent-sdk
```

No other installs required. All other capabilities are code changes to existing files.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Claude Agent SDK API (`query()`, `Options`) | HIGH | Official Anthropic docs at platform.claude.com, verified npm version |
| `@anthropic-ai/claude-agent-sdk` version `^0.2.89` | HIGH | npm registry, confirmed 2026-04-01 |
| Zod peer dep compatibility (`^4.0.0` meets `^4.3.6`) | HIGH | npm info confirmed |
| No `gray-matter` needed | HIGH | Confirmed agent files use `Key: Value` not YAML frontmatter; `org-scanner.ts` already parses them |
| Codex subprocess dispatch stability | MEDIUM | CLI pattern is stable, but non-interactive mode flags not verified against latest `0.118.0` |
| Claude Agent SDK V2 session API stability | LOW | Explicitly marked `unstable_v2_*` in docs; use stable `query()` instead |
| Skills agent-local scan (code change) | HIGH | Pattern directly mirrors existing `skill-sync.ts` logic |
| Parent task DB migration (self-referential FK) | HIGH | SQLite supports this; pattern follows existing FK usage in schema |

---

## Sources

- Claude Agent SDK TypeScript reference: https://platform.claude.com/docs/en/agent-sdk/typescript
- `@anthropic-ai/claude-agent-sdk` npm: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk (v0.2.89)
- `@openai/codex` npm: https://www.npmjs.com/package/@openai/codex (v0.118.0)
- `gray-matter` npm: https://www.npmjs.com/package/gray-matter (v4.0.3, ships `gray-matter.d.ts`)
- Existing codebase: `src/lib/org-scanner.ts`, `src/lib/skill-sync.ts`, `src/lib/agent-runtimes.ts`, `src/lib/task-dispatch.ts`, `src/lib/command.ts`
