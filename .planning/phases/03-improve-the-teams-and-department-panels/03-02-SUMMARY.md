---
phase: 03-improve-the-teams-and-department-panels
plan: 02
subsystem: api
tags: [nextjs, api-routes, sqlite, filesystem, zod]
requires:
  - phase: 03-00
    provides: route scaffolds and org panel data contracts
provides:
  - filesystem + SQLite creation for teams
  - filesystem + SQLite creation for departments
  - filesystem + SQLite creation for agents with manager/team assignment flows
affects: [teams-panel, departments-panel, members-creation, manager-hiring]
tech-stack:
  added: []
  patterns: [zod request validation, stable hash ids from filesystem paths, manual-source upserts]
key-files:
  created: [src/app/api/agents/create/route.ts]
  modified: [src/app/api/teams/route.ts, src/app/api/departments/route.ts]
key-decisions:
  - "Mapped team membership writes to team_external_id because org tables key teams by external_id."
  - "Stored agent stableNumber as config.external_id since agents table has no external_id column."
patterns-established:
  - "Creation routes guard on config.agentsDir and return 400 when missing."
  - "Creation routes always invalidateOrgSnapshot(workspaceId) after successful writes."
requirements-completed: [D-07, D-09, D-10, D-18]
duration: 3min
completed: 2026-03-30
---

# Phase 03 Plan 02: Improve The Teams And Department Panels Summary

**Creation API routes now write teams/departments/agents into both filesystem and SQLite with stable path-derived IDs and org snapshot invalidation.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-30T11:32:33Z
- **Completed:** 2026-03-30T11:35:06Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Replaced stub `POST /api/teams` with validated creation flow that creates team directories, upserts DB rows with `source='manual'`, and invalidates org cache.
- Replaced stub `POST /api/departments` with validated creation flow that creates department directories, upserts DB rows with `source='manual'`, and invalidates org cache.
- Added new `POST /api/agents/create` route that writes `IDENTITY.md`, `AGENT.md`, `SOUL.md`, inserts agent records, assigns members to teams, and supports manager creation in `MANAGER/`.

## Task Commits

1. **Task 1: Implement POST /api/teams and POST /api/departments creation routes** - `cadb0de` (feat)
2. **Task 2: Implement POST /api/agents/create for agent creation with filesystem writes** - `477936b` (feat)

## Files Created/Modified
- `src/app/api/teams/route.ts` - Added validated POST creation logic with team directory creation and DB upsert.
- `src/app/api/departments/route.ts` - Added validated POST creation logic with department directory creation and DB upsert.
- `src/app/api/agents/create/route.ts` - Added full agent create endpoint with markdown file writes and manual assignment persistence.

## Decisions Made
- Used `department_external_id` and `team_external_id` fields for org-table writes to match schema and scanner persistence model.
- Persisted agent model/tool metadata in `agents.config` while setting `source='manual'` and `workspace_path` in the agents table.

## Deviations from Plan

### Auto-fixed Issues

None.

### Out-of-Scope Deferred

- `pnpm typecheck` fails on pre-existing route typing mismatch in `src/app/api/departments/[id]/docs/route.ts` (outside this plan's task files). Logged in `.planning/phases/03-improve-the-teams-and-department-panels/deferred-items.md`.

## Issues Encountered
- Full `pnpm typecheck` did not pass due to unrelated pre-existing changes in other in-flight plan files.
- `pnpm test --run` passed.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Teams/departments/members creation UI can now call real backend endpoints that persist to both DB and filesystem.
- Typecheck should be rerun after the unrelated docs-route type mismatch is resolved by its owning plan.

---
*Phase: 03-improve-the-teams-and-department-panels*
*Completed: 2026-03-30*

## Self-Check: PASSED

- FOUND: `.planning/phases/03-improve-the-teams-and-department-panels/03-02-SUMMARY.md`
- FOUND: `cadb0de`
- FOUND: `477936b`
