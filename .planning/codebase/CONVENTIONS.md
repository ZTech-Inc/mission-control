# Coding Conventions

**Analysis Date:** 2026-03-28

## Naming Patterns

**Files:**
- Route handlers use Next App Router naming: `route.ts` under nested path segments such as `src/app/api/tasks/route.ts` and `src/app/api/tasks/[id]/route.ts`.
- React components use kebab-case filenames with PascalCase exports, e.g. `src/components/ui/button.tsx` exports `Button`, `src/components/layout/nav-rail.tsx` exports `NavRail`.
- Shared library modules use kebab-case utility names in `src/lib/*.ts` such as `src/lib/task-status.ts`, `src/lib/runtime-env.ts`, `src/lib/gateway-runtime.ts`.
- Tests use `*.test.ts` in `src/**/__tests__/` and `*.spec.ts` in `tests/`.

**Functions:**
- Use camelCase for functions and helpers (`formatTicketRef`, `mapTaskRow`, `resolveProjectId` in `src/app/api/tasks/route.ts`).
- Next route handlers are uppercase HTTP names (`GET`, `POST`, `PUT`, `DELETE`) in API files like `src/app/api/connect/route.ts`.
- Boolean predicates are commonly prefixed with `is/has/should` (examples: `hasAegisApproval` in `src/app/api/tasks/[id]/route.ts`, `shouldRedirectDashboardToHttps` in `src/lib/browser-security.ts`).

**Variables:**
- Local mutable values use camelCase (`workspaceId`, `rateCheck`, `resolvedProjectId` in `src/app/api/tasks/route.ts`).
- Environment variables use uppercase snake case (`MC_DISABLE_RATE_LIMIT`, `OPENCLAW_GATEWAY_PORT`, `MISSION_CONTROL_DATA_DIR`) in `src/lib/config.ts` and `scripts/e2e-openclaw/start-e2e-server.mjs`.

**Types:**
- Interfaces and type aliases use PascalCase (`User`, `AgentRun`, `RunStatus`) in `src/lib/auth.ts` and `src/lib/runs.ts`.
- Literal unions are preferred for bounded states (`'admin' | 'operator' | 'viewer'` in `src/lib/auth.ts`, task status unions in `src/lib/validation.ts`).

## Code Style

**Formatting:**
- Prettier config is not detected (`.prettierrc*` absent).
- Formatting is mixed but generally modern TypeScript style with trailing commas in multiline objects and single quotes.
- Semicolon usage is inconsistent across files (minimal semicolons in `src/lib/validation.ts`, frequent semicolons in `src/app/api/tasks/route.ts`).

**Linting:**
- ESLint is configured via `eslint.config.mjs` with `eslint-config-next`.
- `ops/**` and `.data/**` are ignored in linting.
- React hooks rules `set-state-in-effect`, `purity`, and `immutability` are explicitly disabled in `eslint.config.mjs`; do not rely on lint to enforce those constraints.

## Import Organization

**Order:**
1. Framework/platform imports (`next/server`, `react`, Node built-ins), e.g. `src/app/api/connect/route.ts`, `src/app/[[...panel]]/page.tsx`.
2. Project alias imports using `@/` for internal modules (`@/lib/*`, `@/components/*`), e.g. `src/components/ui/button.tsx`.
3. Relative imports are used mainly inside `src/lib` for tightly-coupled internals (`./db`, `./password` in `src/lib/auth.ts`).

**Path Aliases:**
- `@/*` maps to `./src/*` in `tsconfig.json`.
- Use `@/` for cross-folder imports; use relative paths for nearby intra-module relationships in `src/lib`.

## Error Handling

**Patterns:**
- API handlers use early auth guard returns: `const auth = requireRole(...); if ('error' in auth) return ...` in `src/app/api/tasks/route.ts`, `src/app/api/v1/runs/route.ts`.
- Validation follows a reusable helper: `validateBody(request, schema)` returning `{ data } | { error: NextResponse }` from `src/lib/validation.ts`.
- Route handlers wrap main logic in `try/catch`, log with `logger.error`, and return `NextResponse.json(..., { status: 500 })`.
- Input errors use explicit 4xx responses and actionable messages (`Invalid task ID`, `Task not found`, `Aegis approval is required...`) in `src/app/api/tasks/[id]/route.ts`.

## Logging

**Framework:** `pino` via `src/lib/logger.ts`.

**Patterns:**
- Structured logging with context objects (`logger.error({ err: error }, 'GET /api/tasks error')` in `src/app/api/tasks/route.ts`).
- Security/audit events are best-effort and often wrapped in local `try/catch` to avoid blocking request flow (`src/lib/auth.ts`, `src/lib/rate-limit.ts`).
- Development pretty logging is conditional on `pino-pretty` availability (`src/lib/logger.ts`).

## Comments

**When to Comment:**
- Comments are used for intent/rationale around protocol, security, and compatibility behavior (examples in `src/lib/runs.ts`, `src/lib/auth.ts`, `src/app/[[...panel]]/page.tsx`).
- Route files include JSDoc-style endpoint headers (`GET /api/tasks`, `POST /api/connect`) for API semantics.

**JSDoc/TSDoc:**
- Moderate usage on exported helpers and endpoint handlers.
- Types are primarily self-documented through explicit interfaces and union types.

## Function Design

**Size:**
- Small pure helpers are preferred for serialization and mapping (`formatTicketRef`, `mapTaskRow`).
- Larger route handlers are common and contain query construction + side effects; preserve the existing guard-first structure when modifying.

**Parameters:**
- Request handlers accept `NextRequest` and route params object (`{ params: Promise<{ id: string }> }`) in App Router dynamic routes.
- Helpers commonly accept explicit `workspaceId` and database handle for tenant scoping (`resolveProjectId`, `hasAegisApproval`).

**Return Values:**
- API routes return `NextResponse.json`.
- Validation utilities and auth utilities use discriminated union-like shapes (`{ data }` vs `{ error }`, `auth` object with optional `error/status`).

## Module Design

**Exports:**
- `src/lib` modules mostly use named exports; default exports are uncommon.
- UI primitives may export both component and typed props (`Button`, `ButtonProps` in `src/components/ui/button.tsx`).

**Barrel Files:** [Usage]
- Limited barrel usage detected (`src/lib/adapters/index.ts`).
- Most modules are imported directly from concrete file paths.

---

*Convention analysis: 2026-03-28*
