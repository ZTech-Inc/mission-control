---
status: investigating
trigger: "Investigate issue: phase-05-client-bundle-server-imports"
created: 2026-04-01T00:00:00Z
updated: 2026-04-01T00:05:00Z
---

## Current Focus

hypothesis: Phase 05 originally leaked `buildOrgAgentSkillSource` from a `server-only` module into client code, but the workspace may already contain a partial fix; verify whether any remaining client path still imports server-coupled modules and whether production build now succeeds
test: run a production build and continue tracing any surviving client-reachable imports that reference Node-only modules
expecting: either the build still fails with a revised import trace, or the issue is already fixed by extracting the helper into `src/lib/agent-skill-source.ts`
next_action: capture build result and decide whether a code patch or only confirmation/tests are needed

## Symptoms

expected: Teams and agent detail UI compile and load without bundling Node-only server modules into the browser build.
actual: `/teams` returns 500 during compile; client bundle reports unsupported external modules from `node:fs`, `node:child_process`, `fs/promises`, `readline`, `worker_threads`, and `better-sqlite3`.
errors: Import trace shows `agent-detail-tabs.tsx` imports `buildOrgAgentSkillSource` from `src/lib/agent-skills-importer.ts`, which imports `db.ts` and other server-only modules; `app/[[...panel]]/page.tsx` is also a client component.
reproduction: Run dev server and open `/teams` or compile the app after Phase 05 changes.
started: Started after Phase 05 skills import/linking work.

## Eliminated

## Evidence

- timestamp: 2026-04-01T00:03:00Z
  checked: `src/lib/agent-skills-importer.ts`
  found: module begins with `import 'server-only'` and imports `node:fs`, `@/lib/db`, and other server-only dependencies; it now imports `buildOrgAgentSkillSource` from `@/lib/agent-skill-source`
  implication: this file is correctly server-scoped, but any client import of it would force a bundle violation

- timestamp: 2026-04-01T00:04:00Z
  checked: `src/components/panels/agent-detail-tabs.tsx`
  found: client component imports `buildOrgAgentSkillSource` from `@/lib/agent-skill-source`, not from `@/lib/agent-skills-importer`
  implication: the exact import trace described in symptoms does not exist in the current checkout, suggesting a partial or complete fix is already present

- timestamp: 2026-04-01T00:04:30Z
  checked: `src/lib/agent-skill-source.ts`
  found: helper is a pure string builder with no Node or database imports
  implication: this is a valid client-safe extraction point for the shared helper

## Resolution

root_cause:
fix:
verification:
files_changed: []
