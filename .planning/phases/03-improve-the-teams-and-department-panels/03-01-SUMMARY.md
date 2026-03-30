---
phase: 03-improve-the-teams-and-department-panels
plan: 01
subsystem: ui
tags: [zustand, org-scanner, filesystem-sync, department-manager, nextjs]
requires:
  - phase: 03-00
    provides: Baseline TODO tests and docs route wiring for Phase 03 changes
provides:
  - Department manager terminology in store and panel UI
  - Filesystem MANAGER directory handling in org scanner
  - canCreate flag from org data hook for filesystem-backed mode
affects: [03-02, 03-03, departments-panel, org-sync]
tech-stack:
  added: []
  patterns: [filesystem manager directory parsing, reserved department subdirectory filtering]
key-files:
  created:
    - .planning/phases/03-improve-the-teams-and-department-panels/deferred-items.md
  modified:
    - src/store/index.ts
    - src/components/panels/departments-panel.tsx
    - src/app/api/departments/[id]/lead/route.ts
    - src/lib/org-scanner.ts
    - src/lib/use-org-data.ts
key-decisions:
  - "Kept `/api/departments/[id]/lead` route path stable and only renamed UI/store terminology to manager."
  - "Scanner now treats `MANAGER/` as reserved at department level and syncs the first nested manager agent without creating a team assignment."
patterns-established:
  - "Department-level reserved folders are filtered separately from global ignored folders."
  - "Filesystem-scanned manager agents are persisted as `source='filesystem'` and linked through department `manager_agent_id`."
requirements-completed: [D-19, D-20, D-21]
duration: 4m
completed: 2026-03-30
---

# Phase 03 Plan 01: Department Manager Terminology and Filesystem Manager Sync Summary

**Department manager terminology was unified across store/UI while filesystem org scanning now reads `MANAGER/` folders and exposes creation capability via `canCreate`.**

## Performance

- **Duration:** 4m
- **Started:** 2026-03-30T11:31:00Z
- **Completed:** 2026-03-30T11:35:03Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Renamed store action `setDepartmentLead` to `setDepartmentManager` and updated panel call sites and labels to "Department Manager".
- Updated org scanner to skip reserved `MANAGER`/`docs` directories when listing teams and to sync department manager agent from `MANAGER/`.
- Added `canCreate` to `useOrgData` so UI can decouple create controls from `isReadOnly`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename Department Lead to Department Manager across store, API, and UI** - `cd8df6e` (feat)
2. **Task 2: Update org-scanner for MANAGER/ convention and add canCreate flag** - `3c85756` (feat)

## Files Created/Modified
- `src/store/index.ts` - Renamed store API to `setDepartmentManager` and updated error messages.
- `src/components/panels/departments-panel.tsx` - Updated manager selector wiring and UI copy.
- `src/app/api/departments/[id]/lead/route.ts` - Renamed internal validation schema naming to manager terminology.
- `src/lib/org-scanner.ts` - Added reserved department subdir handling and manager agent extraction from `MANAGER/`.
- `src/lib/use-org-data.ts` - Added `canCreate` in returned hook state.
- `.planning/phases/03-improve-the-teams-and-department-panels/deferred-items.md` - Logged out-of-scope pre-existing typecheck blockers.

## Decisions Made
- Preserved lead API route path for compatibility while shifting user-facing naming to manager.
- Used the first directory under `MANAGER/` as department manager source of truth during filesystem scan.

## Deviations from Plan

None - plan tasks were implemented as specified.

## Issues Encountered
- `pnpm typecheck` failed due unrelated pre-existing changes outside this plan (`src/app/api/teams/[id]/docs/route.ts`, missing `src/components/panels/org-docs-panel.tsx`, and route type artifacts in `.next/dev/types/validator.ts`). Logged in `deferred-items.md`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Department panel and store now expose manager terminology required by subsequent Phase 03 plans.
- Scanner manager extraction is in place; follow-up plans can validate with dedicated tests.

## Self-Check: PASSED

- FOUND: `.planning/phases/03-improve-the-teams-and-department-panels/03-01-SUMMARY.md`
- FOUND: `cd8df6e`
- FOUND: `3c85756`

---
*Phase: 03-improve-the-teams-and-department-panels*
*Completed: 2026-03-30*
