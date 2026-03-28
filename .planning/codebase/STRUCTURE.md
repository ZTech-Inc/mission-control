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

*Structure analysis: 2026-03-28*
