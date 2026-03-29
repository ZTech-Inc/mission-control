---
phase: 02-add-way-to-promote-agents-to-team-lead
verified: 2026-03-29T22:21:37Z
status: gaps_found
score: 13/14 must-haves verified
gaps:
  - truth: "Selecting a department lead calls PUT API and updates local state on success"
    status: failed
    reason: "The API route and Zustand action are implemented, but the departments panel renders `DepartmentDetail` from a local `selectedDept` object that is initialized from the store and never resynchronized when `setDepartmentLead` updates the store. The dropdown and department chat continue reading stale `dept.manager_agent_id` in the active view."
    artifacts:
      - path: "src/components/panels/departments-panel.tsx"
        issue: "Uses `selectedDept: Department | null` object state and passes that stale object into `DepartmentDetail`; the effect at lines 638-642 only initializes when `selectedDept` is null, so lead updates do not flow back into the current detail view."
      - path: "src/store/index.ts"
        issue: "Updates `departments` and `selectedDepartment` in Zustand, but the panel does not consume the live store-backed selected department."
    missing:
      - "Derive the selected department from live store data by id, or resync `selectedDept` whenever `departments` changes."
      - "Ensure `DepartmentDetail` reads the updated `manager_agent_id` immediately after `setDepartmentLead` succeeds so the dropdown value and department chat target refresh in place."
---

# Phase 02: Add Way to Promote Agents to Team Lead Verification Report

**Phase Goal:** Add API-backed persistence for promoting/demoting agents to team lead roles and assigning department leads, with inline confirmation UX and visual feedback.
**Verified:** 2026-03-29T22:21:37Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Test stubs exist for team assignment PATCH route before implementation | ✓ VERIFIED | `src/lib/__tests__/team-assignment-route.test.ts` exists with `describe(...)` + `it.todo(...)`; `gsd-tools verify artifacts` passed for `02-00-PLAN.md`. |
| 2 | Test stubs exist for department lead PUT route before implementation | ✓ VERIFIED | `src/lib/__tests__/department-lead-route.test.ts` exists with `describe(...)` + `it.todo(...)`; `gsd-tools verify artifacts` passed for `02-00-PLAN.md`. |
| 3 | Test stubs exist for org-scanner source priority guard before implementation | ✓ VERIFIED | `src/lib/__tests__/org-scanner-source-priority.test.ts` exists with `describe(...)` + `it.todo(...)`; `gsd-tools verify artifacts` passed for `02-00-PLAN.md`. |
| 4 | Team lead role changes persist in SQLite across server restarts | ✓ VERIFIED | `PATCH /api/teams/[id]/assignments` writes `agent_team_assignments` via SQLite transaction and marks rows `source='manual'` (`src/app/api/teams/[id]/assignments/route.ts:40-60`); scanner preserves manual rows on rescan (`src/lib/org-scanner.ts:340-354`). This is an inference from persistent DB writes plus scanner readback. |
| 5 | Department lead assignment persists in SQLite across server restarts | ✓ VERIFIED | Migration `050_departments_manager_agent_id` adds the column (`src/lib/migrations.ts:1475-1480`); `PUT /api/departments/[id]/lead` updates `departments.manager_agent_id` (`src/app/api/departments/[id]/lead/route.ts:25-38`). This is an inference from persistent DB writes. |
| 6 | Filesystem org scanner does not overwrite manually-promoted leads | ✓ VERIFIED | `applyFilesystemOrgPersistence` keeps `role` and `source` when the existing row is manual (`src/lib/org-scanner.ts:344-353`). |
| 7 | `manager_agent_id` is readable from `getOrgSnapshot` after being set via API | ✓ VERIFIED | `scanFilesystemOrg` selects `external_id, manager_agent_id` from `departments` and annotates the in-memory department objects before returning the snapshot (`src/lib/org-scanner.ts:523-534`). |
| 8 | Clicking promote on a team member calls PATCH API and updates local state on success | ✓ VERIFIED | `TeamsPanel` calls `promoteToLead` (`src/components/panels/teams-panel.tsx:52-54,306-338`); store action fetches `PATCH /api/teams/${teamId}/assignments`, refreshes `/api/org/scan?force=true`, then rewrites `agentTeamAssignments` after success (`src/store/index.ts:1338-1372`). |
| 9 | Clicking promote shows brief inline confirmation before executing | ✓ VERIFIED | Non-lead rows swap the button for an inline `promote to lead?` confirmation with `yes/no` controls (`src/components/panels/teams-panel.tsx:306-339`). |
| 10 | Current lead has a visible badge/highlight in the member list | ✓ VERIFIED | Teams panel highlights lead rows with primary-colored role chips and a dedicated `lead` badge (`src/components/panels/teams-panel.tsx:178-186,287-305`). |
| 11 | Department overview tab has a lead selector dropdown | ✓ VERIFIED | Department overview renders a `select` bound to `dept.manager_agent_id` with agent options (`src/components/panels/departments-panel.tsx:200-221`). |
| 12 | Selecting a department lead calls PUT API and updates local state on success | ✗ FAILED | The store action is implemented (`src/store/index.ts:1258-1292`), but the active view renders from stale `selectedDept` object state (`src/components/panels/departments-panel.tsx:632-642,817-818`), so the current detail view does not reliably reflect the updated `manager_agent_id`. |
| 13 | Promote button is visible even when `orgSource` is filesystem | ✓ VERIFIED | `TeamsPanel` passes `isReadOnly`, but the promote control is not gated on `isReadOnly`; only add/remove/drag actions are blocked (`src/components/panels/teams-panel.tsx:46-63,306-338`). |
| 14 | OrgSnapshot cache is refreshed after successful promotion so `useOrgData` sees updated state | ✓ VERIFIED | Both store actions call `/api/org/scan?force=true` after successful mutation (`src/store/index.ts:1274-1278,1354-1358`), and the route invalidates cache before returning a fresh snapshot (`src/app/api/org/scan/route.ts:13-20`). The immediate client update is partly handled by local Zustand writes rather than `useOrgData` reloads; this is an inference. |

**Score:** 13/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/lib/__tests__/team-assignment-route.test.ts` | PATCH route test scaffold | ✓ VERIFIED | Exists, substantive as Wave 0 todo scaffold, discoverable by Vitest. |
| `src/lib/__tests__/department-lead-route.test.ts` | PUT route test scaffold | ✓ VERIFIED | Exists, substantive as Wave 0 todo scaffold, discoverable by Vitest. |
| `src/lib/__tests__/org-scanner-source-priority.test.ts` | Scanner/source-priority test scaffold | ✓ VERIFIED | Exists, substantive as Wave 0 todo scaffold, discoverable by Vitest. |
| `src/lib/migrations.ts` | Migration 050 for `manager_agent_id` | ✓ VERIFIED | Existing assignment-role schema remains in migration 049 and migration 050 adds the department lead column (`src/lib/migrations.ts:1451-1480`). |
| `src/lib/org-scanner.ts` | Manual-source protection + snapshot propagation | ✓ VERIFIED | Manual source guard and `manager_agent_id` rehydration both exist and are wired into scan flow (`src/lib/org-scanner.ts:340-354,523-534`). |
| `src/app/api/teams/[id]/assignments/route.ts` | PATCH endpoint for team role changes | ✓ VERIFIED | Auth, validation, membership check, single-lead transaction, cache invalidation all present (`src/app/api/teams/[id]/assignments/route.ts:13-61`). |
| `src/app/api/departments/[id]/lead/route.ts` | PUT endpoint for department lead assignment | ✓ VERIFIED | Auth, validation, SQL update, 404 handling, cache invalidation all present (`src/app/api/departments/[id]/lead/route.ts:12-38`). |
| `src/store/index.ts` | Async `promoteToLead` and `setDepartmentLead` actions with refresh | ✓ VERIFIED | Both actions are API-first and update store state after success (`src/store/index.ts:1258-1292,1338-1372`). |
| `src/components/panels/teams-panel.tsx` | Promote confirmation UI and lead badge | ✓ VERIFIED | Promote CTA, inline confirm, lead chip, and team chat handoff are all wired to live assignment data (`src/components/panels/teams-panel.tsx:33-42,89-105,166-186,280-338`). |
| `src/components/panels/departments-panel.tsx` | Department lead selector dropdown | ⚠️ HOLLOW | The selector is rendered and wired to the store action, but the detail view consumes a stale `selectedDept` object rather than the updated store-backed department (`src/components/panels/departments-panel.tsx:207-221,632-642,817-818`). |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/app/api/teams/[id]/assignments/route.ts` | `agent_team_assignments` table | `getDatabase()` + transaction | ✓ WIRED | Manual check: route validates membership, demotes prior lead, updates target assignment, and runs both writes in `db.transaction(...)` (`src/app/api/teams/[id]/assignments/route.ts:30-58`). |
| `src/app/api/departments/[id]/lead/route.ts` | `departments` table | `getDatabase()` UPDATE | ✓ WIRED | Manual check: route executes `UPDATE departments SET manager_agent_id = ?` with workspace and external id guard (`src/app/api/departments/[id]/lead/route.ts:25-31`). |
| `src/lib/org-scanner.ts` | `departments` table | SELECT after persistence to annotate snapshot | ✓ WIRED | `scanFilesystemOrg` queries `manager_agent_id` after persistence and mutates the returned departments array (`src/lib/org-scanner.ts:523-534`). |
| `src/store/index.ts` | `/api/teams/{id}/assignments` | fetch PATCH in `promoteToLead` | ✓ WIRED | `promoteToLead` issues the PATCH before mutating local state (`src/store/index.ts:1338-1353`). |
| `src/store/index.ts` | `/api/departments/{id}/lead` | fetch PUT in `setDepartmentLead` | ✓ WIRED | `setDepartmentLead` issues the PUT before mutating local state (`src/store/index.ts:1258-1273`). |
| `src/store/index.ts` | `/api/org/scan?force=true` | fetch GET after successful promotion to refresh OrgSnapshot | ✓ WIRED | Both actions call the forced org scan after a successful mutation (`src/store/index.ts:1274-1278,1354-1358`). |
| `src/components/panels/teams-panel.tsx` | `src/store/index.ts` | `useMissionControl().promoteToLead` | ✓ WIRED | Team roster uses the store action for the inline promote flow (`src/components/panels/teams-panel.tsx:29-31,52-54,306-338`). |
| `src/components/panels/departments-panel.tsx` | `src/store/index.ts` | `useMissionControl().setDepartmentLead` | ✓ WIRED | Department overview selector invokes the store action (`src/components/panels/departments-panel.tsx:83,207-212`). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `src/lib/org-scanner.ts` | `department.manager_agent_id` | `SELECT external_id, manager_agent_id FROM departments` | Yes | ✓ FLOWING |
| `src/store/index.ts` | `agentTeamAssignments`, `departments[*].manager_agent_id` | Successful PATCH/PUT responses followed by local `set(...)` updates | Yes | ✓ FLOWING |
| `src/components/panels/teams-panel.tsx` | `members`, `lead` | Live Zustand `agentTeamAssignments` + `agents` selectors | Yes | ✓ FLOWING |
| `src/components/panels/departments-panel.tsx` | `dept.manager_agent_id`, `leadAgent` | Prop `dept` from local `selectedDept` object state, seeded from `departments` once | No — becomes stale after store update | ✗ HOLLOW_PROP |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Wave 0 test scaffolds still load under Vitest | `pnpm test --run src/lib/__tests__/team-assignment-route.test.ts src/lib/__tests__/department-lead-route.test.ts src/lib/__tests__/org-scanner-source-priority.test.ts` | Exited 0; 3 files loaded, 18 todo tests skipped | ✓ PASS |
| Phase wiring compiles in this workspace | `pnpm typecheck` | Exited 0 | ✓ PASS |

### Requirements Coverage

No `.planning/REQUIREMENTS.md` exists in this repository. Requirement descriptions were cross-referenced from phase plan frontmatter plus `.planning/phases/02-add-way-to-promote-agents-to-team-lead/02-CONTEXT.md`.

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| D-01 | `02-00`, `02-01` | New API route `PATCH /api/teams/:id/assignments` | ✓ SATISFIED | Route exists with auth, validation, membership guard, transaction, and cache invalidation (`src/app/api/teams/[id]/assignments/route.ts:13-61`). |
| D-02 | `02-00`, `02-01` | New API route `PUT /api/departments/:id/lead` | ✓ SATISFIED | Route exists with auth, validation, update, 404 handling, and cache invalidation (`src/app/api/departments/[id]/lead/route.ts:12-38`). |
| D-03 | `02-02` | Zustand actions call API first, then update local state on success | ✓ SATISFIED | Both `setDepartmentLead` and `promoteToLead` fetch before local `set(...)` (`src/store/index.ts:1258-1292,1338-1372`). |
| D-04 | `02-00`, `02-01` | Team leads use existing `agent_team_assignments.role` column | ✓ SATISFIED | Migration 049 already defines `role TEXT NOT NULL DEFAULT 'member'` on `agent_team_assignments` (`src/lib/migrations.ts:1451-1458`). |
| D-05 | `02-00`, `02-01` | Add persistent DB column for department lead assignment | ✓ SATISFIED | Migration 050 adds `manager_agent_id` to `departments` (`src/lib/migrations.ts:1475-1480`). |
| D-06 | `02-02` | Both team lead promotion and department lead assignment are in scope | ✓ SATISFIED | Team path and department path both have API, store, and UI artifacts. |
| D-07 | `02-01` | Team lead promotion updates `AgentTeamAssignment.role` to `lead` | ✓ SATISFIED | Team route updates assignment `role`, store mirrors that change, and teams panel renders lead from assignment role (`src/app/api/teams/[id]/assignments/route.ts:40-58`, `src/store/index.ts:1360-1369`). |
| D-08 | `02-01` | Department lead assignment sets `Department.manager_agent_id` | ✓ SATISFIED | Department route updates `manager_agent_id`, scanner rehydrates it into snapshots, store mirrors it (`src/app/api/departments/[id]/lead/route.ts:25-31`, `src/lib/org-scanner.ts:523-530`, `src/store/index.ts:1280-1289`). |
| D-09 | `02-02` | Both lead assignment flows fully enable embedded chat | ✗ BLOCKED | Team chat updates from live assignment state, but department detail/chat read stale `selectedDept` after reassignment, so the current department chat target does not reliably update in place (`src/components/panels/departments-panel.tsx:137-139,632-642,817-818`). |
| D-10 | `02-02` | Promote stays inline and adds brief confirmation | ✓ SATISFIED | Inline `promote to lead?` confirmation exists in the roster row (`src/components/panels/teams-panel.tsx:306-339`). |
| D-11 | `02-02` | Department overview has a lead selector dropdown | ✓ SATISFIED | `select` rendered in overview with agent options (`src/components/panels/departments-panel.tsx:200-221`). |
| D-12 | `02-02` | Lead has distinct badge/highlight in member list | ✓ SATISFIED | Teams panel uses dedicated lead chip plus primary styling for lead role (`src/components/panels/teams-panel.tsx:178-186,287-305`). |
| D-13 | `02-02` | Promoting a new lead automatically demotes the old lead | ✓ SATISFIED | API transaction demotes prior lead in-team; store mirrors the demotion locally (`src/app/api/teams/[id]/assignments/route.ts:46-58`, `src/store/index.ts:1360-1366`). |
| D-14 | `02-00`, `02-01` | Single lead per team | ✓ SATISFIED | Team mutation demotes any other lead in the same team before updating the target row (`src/app/api/teams/[id]/assignments/route.ts:46-58`). |
| D-15 | `02-02` | Agent can lead multiple teams | ✓ SATISFIED | No global uniqueness constraint exists; demotion is scoped to the target `team_external_id` only (`src/app/api/teams/[id]/assignments/route.ts:46-49`). |
| D-16 | `02-02` | Department lead is separate from team lead | ✓ SATISFIED | Team leads live in `agent_team_assignments`; department leads live in `departments.manager_agent_id`; no coupling logic is present. |
| D-17 | `02-00`, `02-01` | Agent must already be a team member before promotion | ✓ SATISFIED | Team route rejects non-members with 422 before mutating (`src/app/api/teams/[id]/assignments/route.ts:30-38`). |
| D-18 | `02-02` | Existing conversation history is preserved when lead changes | ✓ SATISFIED | Embedded chat message history keys off entity `conversationId`, not lead identity; team uses `team:${team.id}`, department uses `dept:${dept.id}` and `EmbeddedChat` loads/sends by that id (`src/components/panels/teams-panel.tsx:89-96`, `src/components/panels/departments-panel.tsx:522-529`, `src/components/chat/embedded-chat.tsx:43-54,74-100`). |
| D-19 | `02-02` | New messages route to the newly promoted lead automatically | ✗ BLOCKED | Team chat target updates from live assignment data, but the current department detail view can keep using stale `dept.manager_agent_id`, so department chat does not reliably retarget immediately after a lead change (`src/components/panels/departments-panel.tsx:137-139,632-642,817-818`). |
| D-20 | `02-02` | No conversation migration/closure/archive needed on lead change | ✓ SATISFIED | Conversation IDs remain entity-based and no migration/archive logic was added (`src/components/panels/teams-panel.tsx:89-96`, `src/components/panels/departments-panel.tsx:522-529`, `src/components/chat/embedded-chat.tsx:74-100`). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `src/components/panels/departments-panel.tsx` | 632 | Detached local `selectedDept` object state | 🛑 Blocker | Successful `setDepartmentLead` updates the store, but the active detail view keeps reading stale department data, so inline feedback and department chat retargeting fail. |
| `src/lib/__tests__/team-assignment-route.test.ts` | 3 | `it.todo(...)` only coverage | ⚠️ Warning | Route behavior is still undocumented by executable assertions; regressions like the UI/store disconnect were not caught here. |
| `src/lib/__tests__/department-lead-route.test.ts` | 3 | `it.todo(...)` only coverage | ⚠️ Warning | Department lead flow still lacks executable route assertions. |
| `src/lib/__tests__/org-scanner-source-priority.test.ts` | 3 | `it.todo(...)` only coverage | ⚠️ Warning | Scanner/manual-source persistence remains covered only by todo placeholders. |

### Human Verification Required

### 1. Team Promote Flow

**Test:** In the teams panel, open a team with at least two members, click `promote`, confirm `yes`, and then switch to the chat tab.
**Expected:** The new lead badge appears immediately, the prior lead is demoted, and the chat header targets the promoted agent while keeping the same team conversation history.
**Why human:** Visual confirmation timing and roster affordances are UI-level behaviors.

### 2. Department Lead Reassignment Flow

**Test:** In the departments panel overview, change the department lead from the dropdown and then open the chat tab without reselecting the department in the sidebar.
**Expected:** The dropdown retains the chosen agent and the department chat header retargets to that agent immediately.
**Why human:** The current code path appears broken by static analysis; after a fix, this interaction still needs direct UI confirmation.

### Gaps Summary

Phase 02 is close, but the phase goal is not fully achieved. The backend persistence layer is in place: both API routes write to SQLite, the team route enforces single-lead semantics, the department migration exists, and the org scanner preserves manual promotions while rehydrating `manager_agent_id` into snapshots. Team promotion UX is also complete end-to-end, including the inline confirmation, badge/highlight, live role update, and stable entity-based chat routing.

The remaining blocker is in the department UI layer. `setDepartmentLead` correctly updates the database and Zustand state, but `DepartmentsPanel` renders `DepartmentDetail` from a stale `selectedDept` object stored in local React state. Because that object is not rehydrated from the updated `departments` array, the dropdown value and department chat target do not reliably change in the active view after a successful lead assignment. That leaves the department half of the goal short of the required inline visual feedback and automatic chat handoff.

---

_Verified: 2026-03-29T22:21:37Z_
_Verifier: Claude (gsd-verifier)_
