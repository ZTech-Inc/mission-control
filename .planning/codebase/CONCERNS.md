# Codebase Concerns

**Analysis Date:** 2026-03-28

## Tech Debt

**Monolithic UI panels and state store:**
- Issue: Large single-file components and a large global store couple unrelated concerns (UI rendering, network calls, feature toggles, persistence), increasing regression risk for small edits.
- Files: `src/components/panels/agent-detail-tabs.tsx`, `src/components/panels/task-board-panel.tsx`, `src/components/panels/office-panel.tsx`, `src/store/index.ts`
- Impact: High merge-conflict rate, difficult review scope, fragile refactors, and longer onboarding/debug cycles.
- Fix approach: Split each panel into focused feature modules (view, hooks, API client, local types), and split `useMissionControl` into domain stores (tasks, agents, UI preferences, chat).

**Migration file concentration:**
- Issue: Database schema evolution is concentrated in one large migration file with many historical branches.
- Files: `src/lib/migrations.ts`, `src/lib/schema.sql`
- Impact: Hard to reason about upgrade paths; risky edits can affect fresh installs and in-place upgrades simultaneously.
- Fix approach: Introduce migration-per-file strategy with immutable migration scripts and migration metadata checks (id + checksum).

**Silent-failure patterns:**
- Issue: Frequent empty catch blocks and best-effort error swallowing make failures non-observable.
- Files: `src/lib/auth.ts`, `src/lib/rate-limit.ts`, `src/store/index.ts`, `src/app/api/super/os-users/route.ts`, `src/app/api/agents/[id]/files/route.ts`
- Impact: Security/audit failures can go undetected; operational debugging becomes slow because root errors are discarded.
- Fix approach: Replace empty catches with structured warning logs plus correlation IDs; only suppress expected non-critical exceptions with explicit comments.

**OpenAPI parity debt explicitly deferred:**
- Issue: API parity ignores are used as a standing exception for v1 endpoints.
- Files: `scripts/api-contract-parity.ignore`, `scripts/check-api-contract-parity.mjs`, `src/app/api/v1/runs/route.ts`, `src/app/api/v1/evals/leaderboard/route.ts`
- Impact: Contract drift between implementation and `openapi.json` blocks reliable SDK/client generation.
- Fix approach: Remove ignored entries by adding missing OpenAPI operations and fail CI on new unresolved drift.

## Known Bugs

**Spawn history is log-scraped, not source-of-truth:**
- Symptoms: `/api/spawn` history can be incomplete, stale, or empty depending on log retention/format.
- Files: `src/app/api/spawn/route.ts`
- Trigger: Log rotation, missing log directory, or changes in log message format.
- Workaround: Use `spawn_history` table via `src/lib/spawn-history.ts` for history views instead of log parsing.

**Local terminal endpoint is macOS-path specific:**
- Symptoms: `/api/local/terminal` rejects valid Linux directories and is not portable.
- Files: `src/app/api/local/terminal/route.ts`
- Trigger: Running on Linux with non-`/Users/*` home paths.
- Workaround: Disable feature outside macOS or gate with platform-aware allowlist.

**Gateway discovery user parsing is narrow:**
- Symptoms: Some gateway services are not discovered when service/user naming includes unsupported characters.
- Files: `src/app/api/gateways/discover/route.ts`
- Trigger: Service names that do not match `/openclaw-gateway@(\w+)\.service/` or `/openclaw-(\w+)-gateway\.service/`.
- Workaround: Use explicit gateway registration endpoints instead of auto-discovery.

## Security Considerations

**Proxy-auth fallback can trust unpinned source IPs:**
- Risk: If `MC_PROXY_AUTH_HEADER` is enabled but `MC_PROXY_AUTH_TRUSTED_IPS` is unset, header-based impersonation is accepted for backward compatibility.
- Files: `src/lib/auth.ts`
- Current mitigation: Optional trusted-IP allowlist exists.
- Recommendations: Fail closed when proxy auth header is configured without trusted IPs; emit startup hard error.

**Global API key stored in plaintext settings row:**
- Risk: DB compromise exposes active API key directly.
- Files: `src/app/api/tokens/rotate/route.ts`, `src/lib/auth.ts`, `src/app/api/settings/route.ts`
- Current mitigation: Masked display in API responses.
- Recommendations: Store only hash for verification, return key once at creation, and move rotation metadata to separate table.

**Runtime self-hardening mutates `.env` and OpenClaw config from API:**
- Risk: `/api/security-scan/fix` writes security-sensitive runtime files; compromised admin account can alter host-level behavior quickly.
- Files: `src/app/api/security-scan/fix/route.ts`
- Current mitigation: Admin-role requirement and fix-safety metadata.
- Recommendations: Add explicit per-fix approval flow, signed audit entries, and optional read-only mode in production.

**OS-level privileged operations from web route:**
- Risk: Admin endpoint executes privileged system commands (`sudo`, package installs, user creation tooling).
- Files: `src/app/api/super/os-users/route.ts`
- Current mitigation: Admin-role check and non-shell `execFileSync`.
- Recommendations: Move OS provisioning behind an external worker with narrow command allowlist and approval queue.

## Performance Bottlenecks

**Startup migration and scheduler initialization on DB open path:**
- Problem: `getDatabase()` performs migrations and bootstraps listeners/scheduler during first access.
- Files: `src/lib/db.ts`, `src/lib/migrations.ts`, `src/lib/scheduler.ts`
- Cause: Synchronous startup work is coupled to request-time DB initialization.
- Improvement path: Move migration/boot tasks to explicit startup phase and health gate; keep request path lightweight.

**High-cost status endpoint aggregation:**
- Problem: `/api/status` performs multiple DB aggregates and OS command probes in one request path.
- Files: `src/app/api/status/route.ts`
- Cause: Broad metrics collection without caching or budgeted sampling.
- Improvement path: Cache expensive snapshots (short TTL), split heavy diagnostics into dedicated endpoint.

**In-memory rate limiter does not scale horizontally:**
- Problem: Rate-limit state is process-local `Map`; limits reset per process/restart.
- Files: `src/lib/rate-limit.ts`
- Cause: No shared store (Redis/DB) for distributed enforcement.
- Improvement path: Introduce shared limiter backend and standard rate-limit headers across endpoints.

## Fragile Areas

**Task dispatch control flow has many gateway/direct fallback paths:**
- Files: `src/lib/task-dispatch.ts`, `src/lib/openclaw-gateway.ts`, `src/lib/command.ts`
- Why fragile: Mixed gateway JSON parsing, CLI fallbacks, direct API dispatch, and retry logic in one module.
- Safe modification: Add characterization tests before changing dispatch branches; isolate transport adapters first.
- Test coverage: Partial unit coverage exists, but many runtime-only paths are excluded from coverage.

**Integration management couples env parsing, probing, vault pulling, and writes:**
- Files: `src/app/api/integrations/route.ts`
- Why fragile: Very large route file handling many unrelated actions with runtime command probes.
- Safe modification: Split by action (`GET` status, `PUT` write, `POST` test/pull) into dedicated modules with schema-per-action tests.
- Test coverage: No direct route-level test suite detected for integrations workflow.

**Scheduler owns many operational responsibilities in one loop:**
- Files: `src/lib/scheduler.ts`
- Why fragile: Cleanup, backup, heartbeats, retries, sync, dispatch, and recurring tasks share one orchestration path.
- Safe modification: Decompose into independent jobs with explicit failure isolation and telemetry.
- Test coverage: No direct scheduler integration tests detected.

## Scaling Limits

**SQLite single-node write model:**
- Current capacity: Local single-file DB with WAL and 5s busy timeout.
- Limit: Write contention and process-level limits under concurrent route handlers.
- Scaling path: Introduce external DB option (Postgres) or queue write-heavy operations to background workers.

**Process-local event/rate infrastructure:**
- Current capacity: In-memory maps/event bus inside one Next.js process.
- Limit: Multi-instance deployments lose consistency (rate limits, transient state, delivery timing).
- Scaling path: Externalize critical coordination state (Redis/pub-sub + durable queue).

## Dependencies at Risk

**`better-sqlite3` native ABI dependency:**
- Risk: Node version drift causes runtime startup failures.
- Impact: Service boot failure until rebuild is performed.
- Migration plan: Pin Node tightly in deploy targets and provide automated rebuild/verification step in release pipeline.
- Files: `package.json`, `src/lib/db.ts`

**High minimum runtime version requirement:**
- Risk: Node `<22` environments are unsupported and fail verification.
- Impact: Deployment portability is reduced for older managed runtimes.
- Migration plan: Keep compatibility matrix documented and validate runtime at install/deploy entrypoints.
- Files: `package.json`, `scripts/check-node-version.mjs`

## Missing Critical Features

**Durable, first-class spawn execution history API:**
- Problem: History retrieval in `/api/spawn` remains log-derived despite DB-backed spawn history utilities existing.
- Blocks: Reliable audit trail and pagination/filtering for production operations.

**Strict production hardening mode:**
- Problem: Security-sensitive compatibility fallbacks remain enabled (proxy auth trust fallback, mutable runtime env paths).
- Blocks: Safer default posture in internet-exposed deployments.

## Test Coverage Gaps

**Large API surface outpaces route-level tests:**
- What's not tested: Many route handlers (155 `route.ts` files) do not have dedicated per-route verification.
- Files: `src/app/api/**/route.ts`, `tests/**/*.spec.ts`, `src/lib/__tests__/**/*.test.ts`
- Risk: Auth/validation regressions can ship in less-traveled endpoints.
- Priority: High

**Critical operational endpoints lack focused tests:**
- What's not tested: Update workflow and OS-user provisioning execution paths.
- Files: `src/app/api/releases/update/route.ts`, `src/app/api/super/os-users/route.ts`
- Risk: Runtime command failures or privilege regressions in production.
- Priority: High

**Coverage excludes many high-risk server modules:**
- What's not tested: Multiple orchestration/security modules are explicitly excluded from coverage.
- Files: `vitest.config.ts`, `src/lib/task-dispatch.ts`, `src/lib/security-scan.ts`, `src/lib/auth.ts`, `src/lib/webhooks.ts`, `src/lib/migrations.ts`
- Risk: Changes to core execution/security paths may regress without CI signal.
- Priority: High

---

*Concerns audit: 2026-03-28*
