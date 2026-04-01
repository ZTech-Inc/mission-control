---
phase: 05-skills-import-and-linking
plan: 01
subsystem: skills-catalog
tags: [skills, org-scanner, api, ui, vitest]
requires:
  - phase: 04-02
    provides: workspace_path persistence, profile metadata pipeline, agent identity normalization
provides:
  - Dedicated org-agent skill importer scoped per filesystem agent
  - Org-scan hook that imports agent-local skills after profile sync
  - Skills catalog API and panel support for org-agent read-only entries
affects: [org-scanner, skills-api, skills-panel, profile-linking]
tech-stack:
  added: []
  patterns:
    - source-scoped skill import keyed by org-agent slug
    - DB-backed skill content lookup for non-root-backed sources
key-files:
  created:
    - src/lib/agent-skills-importer.ts
    - src/lib/__tests__/agent-skills-importer.test.ts
    - src/lib/__tests__/skills-route-org-agent.test.ts
    - src/components/panels/__tests__/skills-panel-org-agent.test.tsx
  modified:
    - src/lib/org-scanner.ts
    - src/app/api/skills/route.ts
    - src/components/panels/skills-panel.tsx
key-decisions:
  - "Org-agent imports use source keys derived only from normalized agent names so skill ownership survives team/department changes."
  - "The catalog content endpoint reads org-agent skill docs from stored DB paths instead of root whitelists so imported rows remain first-class read targets."
requirements-completed: [SKIL-01]
duration: 10 min
completed: 2026-04-01
---

# Phase 05 Plan 01: Org-Agent Skills Import Summary

**Shipped a source-scoped org-agent skills pipeline that imports agent-local `SKILL.md` files during filesystem scans and exposes them as visible read-only catalog entries.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-01T16:50:00+05:00
- **Completed:** 2026-04-01T17:00:00+05:00
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added a dedicated importer that scans `<workspace>/skills/*/SKILL.md`, hashes content, extracts descriptions, upserts by `(source, name)`, and deletes only missing rows for that same `org-agent:*` source.
- Wired the filesystem org scanner to run the importer after profile sync so Phase 4 `workspace_path` data now feeds skill ingestion without touching the generic global sync path.
- Extended the skills API and Skills panel so imported rows stay visible, readable, and explicitly read-only in the catalog UI.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write org-agent importer and skills route regressions** - `87d01a0` (`test(05-01): add org-agent skill import regressions`)
2. **Task 2: Implement importer, scanner hook, and DB-backed catalog access** - `9059965` (`feat(05-01): import org-agent skills during org scans`)
3. **Task 3: Expose org-agent skills in the panel as read-only entries** - `ffb24c6` (`feat(05-01): expose org-agent skills as read-only catalog entries`)

**Plan metadata:** included in the phase docs closeout commit

## Files Created/Modified

- `src/lib/agent-skills-importer.ts` - Implements org-agent source key generation, skill discovery, content hashing, and source-scoped upsert/delete behavior.
- `src/lib/org-scanner.ts` - Calls `syncOrgAgentSkills()` after filesystem agent persistence completes.
- `src/app/api/skills/route.ts` - Reads org-agent skill docs from DB-backed paths and preserves arbitrary source grouping in catalog responses.
- `src/components/panels/skills-panel.tsx` - Labels org-agent sources clearly and blocks edit/create/delete actions for imported rows.
- `src/lib/__tests__/agent-skills-importer.test.ts` - Covers slugging, re-import updates, and per-source deletion behavior.
- `src/lib/__tests__/skills-route-org-agent.test.ts` - Covers org-agent content lookup and grouped/flat API responses.
- `src/components/panels/__tests__/skills-panel-org-agent.test.tsx` - Covers read-only UI behavior and readable source labeling.

## Decisions Made

- Reused agent-name slugging for `org-agent:<slug>` ownership rather than deriving skill ownership from org hierarchy.
- Kept org-agent rows out of edit flows entirely so the dashboard remains a read-only surface for imported agent-local skills.

## Deviations from Plan

None.

## Validation

- `pnpm test -- --run src/lib/__tests__/agent-skills-importer.test.ts src/lib/__tests__/skills-route-org-agent.test.ts`
- `pnpm test -- --run src/lib/__tests__/skills-route-org-agent.test.ts src/components/panels/__tests__/skills-panel-org-agent.test.tsx`

## User Setup Required

None.

## Next Phase Readiness

- Phase 05-02 can now resolve same-agent skill matches against `org-agent:*` catalog rows.
- The remaining blocker for full Phase 05 completion is the browser checkpoint for Profile-tab skill linking.

## Self-Check: PASSED

- Found `.planning/phases/05-skills-import-and-linking/05-01-SUMMARY.md`
- Found task commit `87d01a0`
- Found task commit `9059965`
- Found task commit `ffb24c6`

---
*Phase: 05-skills-import-and-linking*
*Completed: 2026-04-01*
