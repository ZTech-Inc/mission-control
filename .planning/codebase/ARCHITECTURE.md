# Architecture

**Analysis Date:** 2026-03-28

## Pattern Overview

**Overall:** Next.js App Router monolith with route-handler APIs, shared server-side service modules, and client-side panel shell driven by a central Zustand store.

**Key Characteristics:**
- UI shell and API live in one deployable app under `src/app/` (pages + `route.ts` handlers).
- Business/domain logic is concentrated in `src/lib/` and reused by many API handlers.
- Persistence is SQLite-first (`better-sqlite3`) plus filesystem-backed runtime/session data for local tools and gateway state.

## Layers

**UI Shell + Pages (Client/SSR mix):**
- Purpose: Render the dashboard shell, panel routing, and feature views.
- Location: `src/app/layout.tsx`, `src/app/[[...panel]]/page.tsx`, `src/components/**`.
- Contains: Root layout, dashboard shell, panel components, navigation, onboarding, modals.
- Depends on: `src/store/index.ts`, `src/lib/navigation.ts`, `src/lib/websocket.ts`, API endpoints under `/api/*`.
- Used by: Browser clients.

**API Boundary (Route Handlers):**
- Purpose: HTTP/SSE interface for all domain operations.
- Location: `src/app/api/**/route.ts`.
- Contains: Auth checks, request parsing, validation, orchestration calls, response shaping.
- Depends on: `src/lib/auth.ts`, `src/lib/db.ts`, domain modules in `src/lib/*.ts`.
- Used by: UI fetch calls, gateway/tool integrations, external API consumers (`src/app/api/v1/**`).

**Domain/Service Layer:**
- Purpose: Encapsulate reusable business logic and integration logic.
- Location: `src/lib/*.ts`, `src/lib/adapters/*.ts`.
- Contains: Auth/session helpers, run/task/session management, gateway adapters, cron/security utilities, docs/search logic.
- Depends on: DB layer (`src/lib/db.ts`), Node APIs, external binaries via `src/lib/command.ts`.
- Used by: Route handlers and some client hooks/utilities.

**State + Client Runtime Layer:**
- Purpose: Client-side state model and real-time state updates.
- Location: `src/store/index.ts`, `src/lib/use-server-events.ts`, `src/lib/websocket.ts`.
- Contains: Zustand state/actions, SSE subscription, WebSocket gateway session stream handling.
- Depends on: Browser runtime + `src/lib/*` client-safe utilities.
- Used by: Most `src/components/**` client panels.

**Persistence Layer:**
- Purpose: Durable storage and schema evolution.
- Location: `src/lib/db.ts`, `src/lib/migrations.ts`, `src/lib/schema.sql`.
- Contains: SQLite connection lifecycle, migration runner, DB helper operations, activity/audit logging hooks.
- Depends on: `better-sqlite3`, filesystem paths from `src/lib/config.ts`.
- Used by: Most server routes and service modules.

## Data Flow

**Dashboard Boot Flow (`/` or `/:panel`):**

1. `src/app/[[...panel]]/page.tsx` mounts and initiates boot sequence (auth, status/capabilities, onboarding, preload calls).
2. Client fetches `/api/auth/me`, `/api/status?action=capabilities`, and panel preload endpoints (`/api/agents`, `/api/sessions`, `/api/projects`, `/api/memory/graph`, `/api/skills`).
3. Route handlers authenticate via `requireRole` (`src/lib/auth.ts`), read/write domain state via `src/lib/*`, and return normalized JSON payloads.
4. Client writes results into global Zustand store in `src/store/index.ts`; `ContentRouter` in `src/app/[[...panel]]/page.tsx` selects panel component.

**Mutation + Real-time Update Flow:**

1. Client submits mutations to `/api/*` route handlers (example: `src/app/api/tasks/route.ts`).
2. Route handler validates input (`src/lib/validation.ts`), enforces role/rate limit (`src/lib/auth.ts`, `src/lib/rate-limit.ts`), writes via DB helpers (`src/lib/db.ts`).
3. Domain/service code emits event via `eventBus.broadcast(...)` (`src/lib/event-bus.ts`, `src/lib/runs.ts`, DB helper flows).
4. SSE consumers (`src/app/api/events/route.ts`, `src/app/api/v1/runs/stream/route.ts`) forward events to clients; `src/lib/use-server-events.ts` updates client store.

**Gateway Session Orchestration Flow:**

1. Client chooses gateway or falls back to env URL in `src/app/[[...panel]]/page.tsx`.
2. WebSocket handshake and reconnect logic runs in `src/lib/websocket.ts`.
3. Session and status APIs combine gateway and local sources (`src/app/api/sessions/route.ts`, `src/lib/sessions.ts`, `src/lib/claude-sessions.ts`, `src/lib/codex-sessions.ts`).
4. UI panels consume merged session data from Zustand.

**State Management:**
- Global client state is centralized in `src/store/index.ts` (single Zustand store with typed slices/actions).
- Server state is source-of-truth in SQLite + filesystem-backed sources (`.data`, OpenClaw state, local CLI session logs).

## Key Abstractions

**Auth/RBAC Gate:**
- Purpose: Enforce role-based access and API/session identity.
- Examples: `src/lib/auth.ts`, `src/proxy.ts`, any `src/app/api/**/route.ts` calling `requireRole`.
- Pattern: Edge-ish request gate in proxy + per-route role enforcement.

**Event Bus + SSE Fan-out:**
- Purpose: Decouple writes from real-time push to clients.
- Examples: `src/lib/event-bus.ts`, `src/app/api/events/route.ts`, `src/app/api/v1/runs/stream/route.ts`.
- Pattern: In-process singleton `EventEmitter`, event namespaced types, SSE relay endpoints.

**Run Protocol Subsystem:**
- Purpose: Persist and stream agent-run records/evals.
- Examples: `src/lib/runs.ts`, `src/app/api/v1/runs/route.ts`, `src/app/api/v1/runs/[run_id]/eval/route.ts`.
- Pattern: Domain module with typed entities + v1 API wrapper + SSE stream.

**Plugin Registries (Extension Hooks):**
- Purpose: Allow external registration of integrations/nav/panels/providers.
- Examples: `src/lib/plugins.ts`, `src/plugins/hyperbrowser-example.ts`, `src/lib/plugin-loader.ts`.
- Pattern: Module-scoped registries and register/get APIs; explicit loader placeholder.

## Entry Points

**Web App Entry:**
- Location: `src/app/layout.tsx`.
- Triggers: Next.js request pipeline.
- Responsibilities: Global providers (theme, i18n), metadata, global page shell.

**Main UI Shell:**
- Location: `src/app/[[...panel]]/page.tsx`.
- Triggers: Root and panel routes.
- Responsibilities: Boot orchestration, URL-to-panel mapping, panel composition, realtime hooks.

**Proxy/Middleware Boundary:**
- Location: `src/proxy.ts`.
- Triggers: Matched incoming requests.
- Responsibilities: Host allowlisting, CSRF origin validation, auth gating, CSP nonce/security headers.

**API Surface Entry:**
- Location: `src/app/api/**/route.ts`.
- Triggers: HTTP calls from UI/external consumers.
- Responsibilities: Route-level auth, validation, invoking domain services, returning JSON/SSE.

## Error Handling

**Strategy:** Route handlers use `try/catch` and return typed JSON errors while logging via `logger`.

**Patterns:**
- Guard-first authorization (`requireRole`) with immediate `401/403` returns.
- Validation-first request parsing (`validateBody` + schemas in `src/lib/validation.ts`) before DB writes.
- Operational logging through `src/lib/logger.ts` (`pino`) plus optional `db_helpers.logActivity`.

## Cross-Cutting Concerns

**Logging:** Centralized `pino` logger in `src/lib/logger.ts`; route/service modules log structured errors and operational events.
**Validation:** Request payload validation via schema helpers in `src/lib/validation.ts`; additional ad hoc guard checks in route handlers.
**Authentication:** Proxy gate in `src/proxy.ts` and per-route role checks in `src/lib/auth.ts`; session cookies and optional API key path.

**Server/Client Boundary:**
- Server-only logic lives in route handlers and Node-driven lib modules (`src/app/api/**`, `src/lib/db.ts`, `src/lib/command.ts`).
- Client-only logic is explicitly marked with `'use client'` (e.g., `src/app/[[...panel]]/page.tsx`, `src/components/**`, `src/store/index.ts`).

**Orchestration Boundary:**
- UI orchestration: `src/app/[[...panel]]/page.tsx`.
- Backend orchestration: route handlers compose multiple lib modules (example: `src/app/api/status/route.ts`, `src/app/api/sessions/route.ts`).

**Persistence Boundary:**
- Primary DB boundary: `src/lib/db.ts` + migrations (`src/lib/migrations.ts`, `src/lib/schema.sql`).
- Filesystem state boundary: OpenClaw/Claude/Codex directories via `src/lib/config.ts`, `src/lib/sessions.ts`, `src/lib/claude-sessions.ts`, `src/lib/codex-sessions.ts`.

---

*Architecture analysis: 2026-03-28*
