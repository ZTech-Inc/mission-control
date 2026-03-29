---
phase: 02-add-way-to-promote-agents-to-team-lead
plan: 01
subsystem: api
tags: [sqlite, nextjs, api, zod, org-scanner]
requires:
  - phase: 01-agent-chat-spaces-ui
    provides: lead-aware chat routing that depends on persisted team and department leads
provides:
  - migration 050 for persisted department lead assignments
  - org-scanner source-priority protection for manual lead promotions
  - PATCH /api/teams/:id/assignments for persisted team lead changes
  - PUT /api/departments/:id/lead for persisted department lead changes
affects: [02-02-PLAN.md, embedded chat routing, org snapshot, lead promotion UX]
tech-stack:
  added: []
  patterns: [App Router mutation routes with requireRole and validateBody, SQLite transaction for single-lead enforcement, org snapshot invalidation after role mutations]
key-files:
  created:
    - src/app/api/teams/[id]/assignments/route.ts
    - src/app/api/departments/[id]/lead/route.ts
  modified:
    - src/lib/migrations.ts
    - src/lib/org-scanner.ts
key-decisions:
  - "Manual team lead promotions win over filesystem rescans by preserving source='manual' during assignment upserts."
  - "Department lead persistence uses departments.external_id plus workspace_id so the API can update scanner-backed departments without introducing a second lookup path."
  - "Both mutation routes return a minimal { ok: true } payload and rely on invalidateOrgSnapshot() rather than serving cached snapshot data directly."
patterns-established:
  - "Lead-role mutations go through dedicated App Router endpoints with requireRole, validateBody, SQLite writes, and snapshot invalidation."
  - "Filesystem org sync may refresh timestamps but must not overwrite manual lead assignments."
requirements-completed: [D-01, D-02, D-04, D-05, D-07, D-08, D-14, D-17]
duration: 11min
completed: 2026-03-29
---

# Phase 02 Plan 01: Data Foundation Summary

**SQLite-backed team lead promotion routes, department lead persistence, and scanner protections that preserve manual lead assignments across rescans**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-29T21:44:27Z
- **Completed:** 2026-03-29T21:55:33Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added migration `050_departments_manager_agent_id` so department lead assignments can persist in SQLite.
- Updated the org scanner to preserve manual team lead promotions during filesystem sync and to rehydrate `manager_agent_id` into department snapshots.
- Added `PATCH /api/teams/:id/assignments` and `PUT /api/departments/:id/lead` with auth, validation, DB writes, and snapshot invalidation.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add manager_agent_id migration and fix org-scanner source priority** - `c330427` (feat)
2. **Task 2: Create PATCH /api/teams/[id]/assignments route** - `3732757` (feat)
3. **Task 3: Create PUT /api/departments/[id]/lead route** - `ae79f89` (feat)

## Files Created/Modified

- `src/lib/migrations.ts` - Adds migration 050 with a guarded `manager_agent_id` column addition for departments.
- `src/lib/org-scanner.ts` - Preserves manual assignment roles during scanner upserts and annotates departments with persisted lead IDs.
- `src/app/api/teams/[id]/assignments/route.ts` - PATCH endpoint for member-to-lead role changes with team membership validation and single-lead transaction logic.
- `src/app/api/departments/[id]/lead/route.ts` - PUT endpoint for setting or clearing persisted department lead assignments.

## Decisions Made

- Preserved manual assignment role and source during scanner conflict updates so filesystem rescans cannot silently demote a promoted lead.
- Kept both new APIs write-only with snapshot invalidation instead of returning refreshed org payloads, matching the existing cache invalidation model.
- Used `workspace_id + external_id` for both route handlers because UI team and department IDs map to the filesystem-backed external IDs persisted in SQLite.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Guarded migration 050 against pre-existing local schema drift**
- **Found during:** Task 1
- **Issue:** A bare `ALTER TABLE departments ADD COLUMN manager_agent_id` would fail if a local database already had the column without the migration recorded.
- **Fix:** Added a `PRAGMA table_info(departments)` check before running the required `ALTER TABLE` statement.
- **Files modified:** src/lib/migrations.ts
- **Verification:** `pnpm typecheck` exited 0 after the migration update and route/scanner changes.
- **Committed in:** `c330427`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The guard kept the planned migration behavior while avoiding a local upgrade failure. No scope creep.

## Issues Encountered

- Parallel `git add` calls briefly collided on `.git/index.lock` during Task 1 staging. Restaging sequentially resolved it without changing plan scope or repository state.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `02-02-PLAN.md` can now wire the store and panel UX against stable mutation endpoints and a scanner that preserves manual promotions.
- Embedded chat routing can now read persisted team and department leads from refreshed org snapshots after UI actions are added.

## Self-Check: PASSED

- Found `.planning/phases/02-add-way-to-promote-agents-to-team-lead/02-01-SUMMARY.md`
- Found task commit `c330427`
- Found task commit `3732757`
- Found task commit `ae79f89`
- Stub scan found no unresolved placeholders in plan-owned files; `org-scanner` matches were SQL placeholder variable names.

---
*Phase: 02-add-way-to-promote-agents-to-team-lead*
*Completed: 2026-03-29*
