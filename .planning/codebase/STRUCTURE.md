# Codebase Structure

**Analysis Date:** 2026-03-28

## Directory Layout

```text
mission-control/
├── src/                    # Application source (Next.js app, API routes, shared libs, UI components)
├── tests/                  # End-to-end and integration specs (Playwright-driven API/UI coverage)
├── scripts/                # Operational, CLI, build, and utility scripts
├── docs/                   # Product/deployment/security docs and release notes
├── public/                 # Static web assets (brand, sprites, icons)
├── ops/                    # Ops templates and deployment support artifacts
├── messages/               # i18n message catalogs
├── skills/                 # Mission-control specific skill content
└── .planning/              # Planning artifacts, including codebase mapping docs
```

## Directory Purposes

**`src/app/`:**
- Purpose: Next.js App Router pages + API route handlers.
- Contains: `layout.tsx`, route pages (`login`, `setup`, `docs`), catch-all panel route, and `/api/**` handlers.
- Key files: `src/app/layout.tsx`, `src/app/[[...panel]]/page.tsx`, `src/app/api/tasks/route.ts`, `src/app/api/status/route.ts`.

**`src/components/`:**
- Purpose: UI composition layer and panel implementations.
- Contains: Dashboard widgets, panel modules, shared UI primitives, layout components.
- Key files: `src/components/layout/nav-rail.tsx`, `src/components/dashboard/dashboard.tsx`, `src/components/panels/task-board-panel.tsx`, `src/components/ui/button.tsx`.

**`src/lib/`:**
- Purpose: Shared domain logic and platform services.
- Contains: DB access, auth/session helpers, eventing, gateway integration, security, adapters, orchestration helpers.
- Key files: `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/event-bus.ts`, `src/lib/runs.ts`, `src/lib/config.ts`.

**`src/store/`:**
- Purpose: Global client state and actions.
- Contains: Single Zustand store used by most client views.
- Key files: `src/store/index.ts`.

**`src/plugins/`:**
- Purpose: Plugin examples/extensions.
- Contains: Plugin registration examples.
- Key files: `src/plugins/hyperbrowser-example.ts`, `src/lib/plugins.ts`, `src/lib/plugin-loader.ts`.

**`tests/`:**
- Purpose: Broad black-box coverage of API/UI behavior.
- Contains: `.spec.ts` files grouped by feature area.
- Key files: `tests/tasks-crud.spec.ts`, `tests/auth-guards.spec.ts`, `tests/gateway-connect.spec.ts`, `tests/openapi.spec.ts`.

**`scripts/`:**
- Purpose: Local tooling and runtime helpers.
- Contains: CLI/TUI launchers, parity checks, deploy/start scripts, security checks.
- Key files: `scripts/mc-cli.cjs`, `scripts/mc-mcp-server.cjs`, `scripts/start-standalone.sh`, `scripts/check-api-contract-parity.mjs`.

**`docs/`:**
- Purpose: Product and operations documentation.
- Contains: Quickstart, deployment, security hardening, orchestration docs, releases.
- Key files: `docs/quickstart.md`, `docs/deployment.md`, `docs/SECURITY-HARDENING.md`, `docs/releases/2.0.1.md`.

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root layout and global providers.
- `src/app/[[...panel]]/page.tsx`: Main dashboard page shell and panel router.
- `src/proxy.ts`: Request middleware/proxy security boundary.

**Configuration:**
- `next.config.js`: Next.js build/output/security header config.
- `tsconfig.json`: TypeScript compiler setup and `@/*` alias mapping.
- `src/lib/config.ts`: Runtime path/env resolution for DB, OpenClaw state, memory, logs.

**Core Logic:**
- `src/lib/db.ts`: SQLite connection lifecycle and DB helper exports.
- `src/lib/migrations.ts`: Schema migration pipeline.
- `src/lib/auth.ts`: Session and role-based auth logic.
- `src/lib/websocket.ts`: Gateway WebSocket client orchestration.
- `src/lib/sessions.ts`: Filesystem-backed gateway session scanning.

**Testing:**
- `vitest.config.ts`: Unit/integration test runner config.
- `playwright.config.ts`: E2E/browser test config.
- `tests/*.spec.ts`: API/UI integration and E2E scenarios.
- `src/lib/__tests__/*.test.ts`: Unit coverage for lib utilities/modules.

## Naming Conventions

**Files:**
- Route handlers use `route.ts` in nested App Router directories (example: `src/app/api/projects/[id]/route.ts`).
- React component files use kebab-case `.tsx` names (example: `src/components/panels/security-audit-panel.tsx`).
- Service/helper modules in `src/lib` use kebab-case `.ts` names (example: `src/lib/security-events.ts`).
- Test files use `*.test.ts` for unit (`src/lib/__tests__/task-routing.test.ts`) and `*.spec.ts` for integration/e2e (`tests/tasks-crud.spec.ts`).

**Directories:**
- Feature-first API folders under `src/app/api/<feature>/...`.
- UI grouped by concern: `src/components/panels`, `src/components/dashboard`, `src/components/layout`, `src/components/ui`.

## Where to Add New Code

**New API-backed Feature:**
- Primary code: add route handler(s) under `src/app/api/<feature>/route.ts` or nested resource paths.
- Shared domain logic: add/reuse module(s) in `src/lib/<feature>.ts`.
- Tests: add unit tests in `src/lib/__tests__/<feature>.test.ts` and integration specs in `tests/<feature>.spec.ts`.

**New Panel/Screen in Dashboard:**
- Implementation: add panel component under `src/components/panels/<feature>-panel.tsx`.
- Navigation: wire panel id in `src/components/layout/nav-rail.tsx`.
- Router binding: map tab id in `ContentRouter` inside `src/app/[[...panel]]/page.tsx`.

**New Shared UI Component:**
- Implementation: `src/components/ui/<component>.tsx`.
- Consume from panels/pages using alias import `@/components/ui/<component>`.

**New Cross-cutting Service:**
- Shared helpers and domain functions: `src/lib/<module>.ts`.
- If client hook, keep it client-safe and place in `src/lib/use-*.ts`.

**New Store State Slice/Action:**
- Extend `src/store/index.ts` (single-store pattern).
- Keep API-fetch side effects in panels/hooks; keep store focused on state and state transitions.

**New Plugin Extension:**
- Registry contracts: `src/lib/plugins.ts`.
- Plugin module: `src/plugins/<plugin>.ts`.
- Loader wiring point: `src/lib/plugin-loader.ts`.

## Special Directories

**`src/app/api/v1/`:**
- Purpose: Versioned API surface for run/eval protocol consumers.
- Generated: No.
- Committed: Yes.

**`src/lib/adapters/`:**
- Purpose: Runtime/framework adapter definitions and compliance tests.
- Generated: No.
- Committed: Yes.

**`src/lib/__tests__/`:**
- Purpose: Unit tests co-located with service modules.
- Generated: No.
- Committed: Yes.

**`.data/`:**
- Purpose: Local runtime data directory (SQLite DB, token files, runtime state).
- Generated: Yes.
- Committed: No (excluded from production tracing; runtime artifact).

**`.planning/codebase/`:**
- Purpose: Codebase mapping docs used by planning/execution workflows.
- Generated: Yes (by mapper workflows).
- Committed: Yes (planning artifact).

---

## Memory Page Deep-Dive

**Analysis Date:** 2026-03-29

### Route & Entry Point

`src/app/[[...panel]]/page.tsx` → `ContentRouter` maps `activeTab === 'memory'` → `<MemoryBrowserPanel />`

### Components

| File | Purpose |
|------|---------|
| `src/components/panels/memory-browser-panel.tsx` | Main panel (~16K lines) — file tree, content editor, search, health, pipeline tabs |
| `src/components/panels/memory-graph.tsx` | Force-directed graph visualization (Reagraph); Obsidian-style agent/file drill-down |

**Panel tabs:** Files · Graph · Health · Pipeline

### API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `src/app/api/memory/route.ts` | GET/POST/DELETE | File tree (`action=tree`), content (`action=content`), search (`action=search`), save, delete |
| `src/app/api/memory/graph/route.ts` | GET | Agent SQLite DB stats for graph visualization |
| `src/app/api/memory/search/route.ts` | GET/POST | FTS5 search + manual index rebuild |
| `src/app/api/memory/health/route.ts` | GET | 8-category diagnostic report (schema, connectivity, freshness, atomicity, naming, etc.) |
| `src/app/api/memory/links/route.ts` | GET | Wiki-link graph — single file or full graph with orphan detection |
| `src/app/api/memory/process/route.ts` | POST | Pipeline: `reflect` / `reweave` / `generate-moc` / `gap-detect` / `consolidate` |
| `src/app/api/agents/[id]/memory/route.ts` | GET/PUT/DELETE | Per-agent working memory scratchpad (syncs to WORKING.md in workspace) |

### Data Layer

| File | Purpose |
|------|---------|
| `src/lib/memory-utils.ts` | Wiki-link extraction, schema validation, health diagnostics, file scanning, MOC generation, pipeline passes |
| `src/lib/memory-search.ts` | SQLite FTS5 index (porter tokenizer), BM25 search, incremental per-file indexing |
| `src/lib/memory-path.ts` | Path security: allowlist prefix checks, symlink escape prevention via realpath validation |

### Zustand State (`src/store/index.ts`)

```typescript
memoryFiles: MemoryFile[]
selectedMemoryFile: string | null
memoryContent: string | null
memoryFileLinks: { wikiLinks, incoming, outgoing }
memoryHealth: unknown | null
memoryGraphAgents: AgentGraphData[] | null  // persisted across tab switches
```

### UI Style & Visual Patterns

**Layout:**
- Full-height panel: `h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden`
- Top bar: `flex items-center gap-1 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]`
- Sidebar: fixed `w-60`, `border-r border-border`, collapsible via `|||` button
- Main content: `flex-1 min-w-0 bg-[hsl(var(--surface-0))]`

**Color tokens (CSS vars, not raw colors):**
- Surfaces: `bg-[hsl(var(--surface-0))]` (base), `bg-[hsl(var(--surface-1))]` (inset), `bg-[hsl(var(--surface-2))]` (hover/selected)
- Text: `text-foreground`, `text-muted-foreground`, `text-muted-foreground/60`, `text-muted-foreground/40`, `text-muted-foreground/30`
- Borders: `border-border`, `border-border/50`
- Accent: `text-primary`, `text-primary/80`, `bg-primary/10`

**Typography:**
- All UI chrome is `font-mono` — tabs, tree nodes, badges, buttons, inputs
- Sizes: `text-xs` (12px) for most UI, `text-[13px]` for tree nodes, `text-[11px]` for secondary labels, `text-[10px]` for metadata/badges
- Rendered markdown headings: `text-xl font-bold` (H1), `text-lg font-semibold` (H2), `text-base font-semibold` (H3) — all `font-mono`

**Buttons (inline, no `<Button>` component):**
- Tab / toggle: `px-2.5 py-1 rounded text-xs font-mono transition-colors`; active = `bg-[hsl(var(--surface-2))] text-foreground`; inactive = `text-muted-foreground hover:text-foreground`
- Action buttons: `px-2 py-0.5 text-[11px] font-mono rounded hover:bg-[hsl(var(--surface-2))] transition-colors`
- Destructive: `text-red-400/60 hover:text-red-400 hover:bg-red-500/10`
- Save/confirm: `text-green-400/80 hover:text-green-400 hover:bg-green-500/10`

**Inputs:**
- `px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded placeholder-muted-foreground/40 focus:outline-none focus:border-primary/30`

**File tree:**
- Node row: `flex items-center gap-1 py-[3px] pr-2 rounded-sm hover:bg-[hsl(var(--surface-2))] transition-colors duration-75`
- Indent: `paddingLeft: 8 + depth * 14` px (inline style)
- Icons: raw text symbols — `#` for `.md`, `{}` for JSON, `|` for txt/log, `~` default, `/` for directories
- Size badge: `text-[10px] text-muted-foreground/40 tabular-nums`

**Status indicators (health):**
- Colors via helper functions: healthy=`text-green-400`/`bg-green-500`, warning=`text-amber-400`/`bg-amber-500`, critical=`text-red-400`/`bg-red-500`
- Schema warnings banner: `bg-amber-500/5 border-b border-amber-500/15`, text `text-amber-400`

**Empty states:**
- Large text symbol (`/`, `~`) in `text-4xl font-mono`, followed by `text-sm font-mono text-muted-foreground/30`

**Code blocks (markdown renderer):**
- `bg-[hsl(var(--surface-1))] border border-border/50 rounded-md px-3 py-2 my-2 text-xs font-mono`

**Inline code (markdown):**
- `bg-[hsl(var(--surface-2))] px-1 py-0.5 rounded text-[12px] font-mono text-primary/80`

**Wiki-links (inline):**
- `text-primary/80 hover:text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors font-mono text-[12px]`

### Key Patterns

- **Auth guards:** viewer=GET, operator=POST/PUT, admin=DELETE
- **File tree:** lazy-loaded — depth=1 on mount, full tree fetched async
- **Search:** SQLite FTS5 with porter tokenizer; single word → `word*` (prefix), multi-word → AND with prefix; BM25 ranking
- **No data-fetching library:** all API calls via raw `fetch()` inside the panel component
- **Translations:** `useTranslations('memoryBrowser')` / `useTranslations('memoryGraph')`
- **Logging:** `createClientLogger('MemoryBrowser')`
- **File scan limits:** max 2000 files, skip files >1MB, `.md`/`.txt` only
- **Path safety:** every file op checks allowlist + resolves realpath to block traversal

---

*Structure analysis: 2026-03-28 | Memory page added: 2026-03-29*
