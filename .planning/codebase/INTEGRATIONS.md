# External Integrations

**Analysis Date:** 2026-03-28

## APIs & External Services

**AI/Gateway:**
- OpenClaw Gateway - bidirectional runtime integration for agent dispatch, status, and websocket session streaming.
  - SDK/Client: internal gateway helpers in `src/lib/openclaw-gateway.ts`, `src/lib/gateway-runtime.ts`, browser WS client in `src/lib/websocket.ts`.
  - Auth: `OPENCLAW_GATEWAY_TOKEN` / `GATEWAY_TOKEN` or password mode vars in `src/lib/gateway-runtime.ts`.
- Anthropic Messages API (`https://api.anthropic.com/v1/messages`) - fallback direct dispatch when gateway path is unavailable in `src/lib/task-dispatch.ts`.
  - SDK/Client: native `fetch`.
  - Auth: `ANTHROPIC_API_KEY`.
- Ollama local API (`/api/tags`) health probing from integrations panel.
  - SDK/Client: native `fetch` in `src/app/api/integrations/route.ts`.
  - Auth: optional `OLLAMA_API_KEY` (integration catalog), host via `OLLAMA_HOST`.

**Identity/Auth Providers:**
- Google Identity token verification (`https://oauth2.googleapis.com/tokeninfo`) for Sign-In.
  - SDK/Client: native `fetch` in `src/lib/google-auth.ts`, route handler in `src/app/api/auth/google/route.ts`.
  - Auth: `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` for audience validation.

**Developer/SCM:**
- GitHub REST API (`https://api.github.com`) for issue/label/PR/task sync.
  - SDK/Client: internal wrapper in `src/lib/github.ts`, orchestration in `src/lib/github-sync-engine.ts`, API routes under `src/app/api/github/**`.
  - Auth: `GITHUB_TOKEN` (resolved from OpenClaw `.env` via `src/lib/runtime-env.ts` then `process.env` fallback).

**Webhook Delivery (Outgoing):**
- Operator-configured external webhook URLs receive Mission Control events.
  - SDK/Client: delivery engine in `src/lib/webhooks.ts`, CRUD API in `src/app/api/webhooks/route.ts`.
  - Auth: per-webhook HMAC signature (`X-MC-Signature`, `sha256=`) using webhook secret.

**Optional Tool Provider Integrations (catalog + health checks):**
- Integration registry in `src/app/api/integrations/route.ts` includes Anthropic/OpenAI/OpenRouter/Venice/NVIDIA/Moonshot/Ollama, Brave, X/Twitter, LinkedIn, Telegram, GitHub, Google Workspace CLI, 1Password, Hyperbrowser.
  - SDK/Client: primarily env + CLI probes (`op`, `xint`, `gws`) and selected HTTP health checks.
  - Auth: provider-specific env vars (for example `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `HYPERBROWSER_API_KEY`, `OP_SERVICE_ACCOUNT_TOKEN`).

## Data Storage

**Databases:**
- SQLite (local file) via `better-sqlite3`.
  - Connection: `MISSION_CONTROL_DB_PATH` (or derived from `MISSION_CONTROL_DATA_DIR`) in `src/lib/config.ts`.
  - Client: `better-sqlite3` through `src/lib/db.ts`.
- Secondary read-only SQLite access for Hermes session data in `src/lib/hermes-sessions.ts`.

**File Storage:**
- Local filesystem only.
- Runtime data and generated credentials in `.data` (managed in `src/lib/config.ts` and `src/lib/auto-credentials.ts`).
- Knowledge/memory files read from OpenClaw workspace/state paths via `src/lib/memory-utils.ts`, `src/lib/memory-path.ts`.

**Caching:**
- No external cache service detected.
- In-memory process-local caches are used for short-lived probe data (for example `integrationProbeCache` in `src/app/api/integrations/route.ts`).

## Authentication & Identity

**Auth Provider:**
- Hybrid custom auth.
  - Implementation: local username/password and session cookies/API key in `src/lib/auth.ts`; Google Sign-In in `src/app/api/auth/google/route.ts` + `src/lib/google-auth.ts`; optional trusted proxy header auth through `MC_PROXY_AUTH_*` envs in `src/lib/auth.ts`.

## Monitoring & Observability

**Error Tracking:**
- Not detected for third-party SaaS error trackers (no Sentry/Datadog SDK imports found).

**Logs:**
- Structured app logging via Pino (`src/lib/logger` usage across API/lib).
- Audit/security event persistence in SQLite tables through helpers in `src/lib/db.ts` and `src/lib/security-events.ts`.

## CI/CD & Deployment

**Hosting:**
- Self-hosted Next.js standalone process (`scripts/start-standalone.sh`, `scripts/deploy-standalone.sh`).
- Container runtime support via `Dockerfile` and `docker-compose.yml`.

**CI Pipeline:**
- GitHub Actions:
- Quality gate workflow for lint/typecheck/unit/build/E2E in `.github/workflows/quality-gate.yml`.
- Container publish workflow to GHCR (and optionally Docker Hub) in `.github/workflows/docker-publish.yml`.

## Environment Configuration

**Required env vars:**
- Core auth/session: `API_KEY`, `AUTH_USER`, `AUTH_PASS` or `AUTH_PASS_B64`, `AUTH_SECRET` (referenced in `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/auto-credentials.ts`).
- Data/runtime paths: `MISSION_CONTROL_DATA_DIR`, `MISSION_CONTROL_DB_PATH`, `MISSION_CONTROL_TOKENS_PATH` (`src/lib/config.ts`).
- Gateway connectivity: `OPENCLAW_GATEWAY_HOST`, `OPENCLAW_GATEWAY_PORT`, optional `OPENCLAW_GATEWAY_TOKEN`/`GATEWAY_TOKEN` (`src/lib/config.ts`, `src/lib/gateway-runtime.ts`).
- Optional external integrations: `GITHUB_TOKEN`, `GOOGLE_CLIENT_ID`, `ANTHROPIC_API_KEY`, provider tokens listed in `src/app/api/integrations/route.ts`.

**Secrets location:**
- Runtime process environment (`process.env`) across server modules.
- OpenClaw sidecar env file resolution from `join(config.openclawStateDir, '.env')` in `src/lib/runtime-env.ts`.
- Auto-generated fallback secrets persisted to `.data/.auto-generated` in `src/lib/auto-credentials.ts`.

## Webhooks & Callbacks

**Incoming:**
- No dedicated third-party inbound webhook receiver routes detected; `/api/webhooks` routes in `src/app/api/webhooks/route.ts` manage webhook definitions and delivery metadata, not external callback ingestion.

**Outgoing:**
- Event-driven webhook POST delivery to operator-defined endpoints from `src/lib/webhooks.ts`.
- Additional outbound HTTP calls to provider APIs (Google tokeninfo, GitHub API, Anthropic API, optional Hyperbrowser endpoint in `src/plugins/hyperbrowser-example.ts`).

---

*Integration audit: 2026-03-28*
