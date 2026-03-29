# Phase 02: Add Way to Promote Agents to Team Lead - Research

**Researched:** 2026-03-30
**Domain:** Next.js App Router API routes, SQLite (better-sqlite3), Zustand store mutations, React UI interaction patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Persistence & API Shape**
- D-01: New API route: `PATCH /api/teams/:id/assignments` to update an agent's role within a team
- D-02: New API route: `PUT /api/departments/:id/lead` to set `manager_agent_id`
- D-03: Zustand actions call API first, then update local state on success (optimistic update with rollback on failure)
- D-04: `agent_team_assignments` table already has `role` column — no schema migration needed for team leads
- D-05: Department `manager_agent_id` column already exists — no schema migration needed for department leads

**Scope — Team Leads + Department Leads**
- D-06: Both team lead promotion and department lead assignment are in scope
- D-07: Team lead: update `AgentTeamAssignment.role` to 'lead' (existing data model)
- D-08: Department lead: set `Department.manager_agent_id` (existing data model)
- D-09: Both are required to fully enable embedded chat (Phase 1 shows empty states when no lead is assigned)

**Promotion UX**
- D-10: Keep existing "promote" inline button in teams members list — enhance with brief inline confirmation (not modal)
- D-11: Add a department lead selector in the department overview tab (dropdown or agent picker)
- D-12: Visual feedback: lead gets a distinct badge/highlight in the member list (reuse Phase 1 AgentStatusBadge patterns)
- D-13: Demoting old lead to member happens automatically when a new lead is promoted (existing `handleSetLead` behavior preserved)

**Lead Constraints**
- D-14: Single lead per team — promoting a new agent automatically demotes the existing lead to member
- D-15: An agent can lead multiple teams — no restriction
- D-16: Department lead is separate from team lead — same agent can hold both roles
- D-17: An agent must be a team member before being promoted to lead (no promoting unassigned agents)

**Chat Routing Impact**
- D-18: Existing conversation history is preserved when lead changes
- D-19: New messages in embedded chat route to the newly promoted lead automatically
- D-20: No need to migrate, close, or archive conversations when lead changes

### Claude's Discretion
- API error handling patterns (validation, 4xx responses)
- Whether to batch team + department lead operations or keep separate endpoints
- Exact confirmation UX for promotion (tooltip, inline expand, etc.)
- Testing approach and coverage

### Deferred Ideas (OUT OF SCOPE)
- Bulk role assignment (promoting multiple agents at once)
- Lead rotation scheduling
- Lead assignment history/audit trail
- Notification when lead changes (notify team members)
- Permission-based lead assignment (only admins can promote)
- Cross-department lead visibility
</user_constraints>

---

## Summary

This phase wires the existing store-only promotion UX to real API persistence. The work spans three layers: two new API route handlers that write to SQLite, two enhanced Zustand store actions that call those routes before updating local state, and minor UI enhancements to the teams and departments panels. No database schema migrations are required for either concern — the `role` column on `agent_team_assignments` and the `Department` TypeScript type's `manager_agent_id` field both exist. However, `manager_agent_id` is **not yet a column in the `departments` DB table** (migration 049 does not include it), which means a new migration is needed before the department lead API can persist anything.

A second critical finding is that the org-scanner's assignment upsert unconditionally overwrites `role` on conflict regardless of `source`. If a user promotes an agent via the API (source='manual') and the filesystem scanner re-runs, the promotion will be silently reverted. The fix must add a `WHERE source != 'manual'` guard to the scanner's upsert `DO UPDATE SET` clause, or the new API must use a separate assignment row with a precedence scheme.

The data flow for org state is: filesystem scan → SQLite → in-memory `OrgSnapshot` cache → `/api/org/scan` GET → `useOrgData()` hook → Zustand store. API-written assignments need to survive this round-trip: they must be readable from the scan endpoint, not just from the DB directly.

**Primary recommendation:** Add a `manager_agent_id` column migration to `departments`, fix the scanner upsert to not overwrite manual sources, implement two new API routes with `getDatabase()` + `validateBody` + `requireRole`, update `assignAgentToTeam` and a new `setDepartmentLead` Zustand action to call the API first, and augment the two panels with minimal inline confirmation UX.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | project version | Synchronous SQLite writes | Already used for all DB operations in this project |
| zod | project version | Request body validation | `validateBody` already wraps it; all API routes use it |
| next/server (NextRequest/NextResponse) | Next.js 16 | API route handlers | Established pattern in every route file |
| zustand | project version | Client state + API orchestration | `useMissionControl` store is the single client state source |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @/lib/auth `requireRole` | internal | Auth guard on new routes | Every mutating API route uses it |
| @/lib/validation `validateBody` | internal | Parse + validate POST/PATCH/PUT bodies | Used in agents route and all mutation routes |
| @/lib/db `getDatabase` | internal | Get the singleton DB connection | Used for direct SQL in all existing DB-writing routes |
| @/lib/event-bus `eventBus` | internal | Emit events after mutations | Used in agents route after writes; triggers org refresh |
| @/lib/org-scanner `invalidateOrgSnapshot` | internal | Invalidate the org snapshot cache | Call after any assignment or department lead change so next GET /api/org/scan sees fresh data |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate `PATCH /api/teams/:id/assignments` | Extend existing `POST /api/teams/:id/members` | Separate endpoint is cleaner semantically for role-only updates; avoids mutating the members list endpoint |
| New `PUT /api/departments/:id/lead` | Reuse existing `PUT /api/departments/:id` | Dedicated endpoint is clearer; existing PUT is currently a stub anyway |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

No new directories. New files:
```
src/app/api/teams/[id]/assignments/route.ts   # PATCH — update agent role in team
src/app/api/departments/[id]/lead/route.ts    # PUT — set department manager_agent_id
src/lib/migrations.ts                          # add 050_departments_manager_agent_id migration
src/store/index.ts                             # update assignAgentToTeam + add setDepartmentLead
src/components/panels/teams-panel.tsx          # enhance promote button + lead badge
src/components/panels/departments-panel.tsx    # add lead selector UI
src/lib/org-scanner.ts                         # fix upsert to not overwrite manual source
```

### Pattern 1: API Route with DB Write (established project pattern)

**What:** `requireRole` guard → `validateBody` with Zod schema → `getDatabase()` → synchronous SQL → `invalidateOrgSnapshot()` → return JSON.
**When to use:** Every new mutating API route in this project.

```typescript
// Source: src/app/api/agents/route.ts (project pattern)
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { getDatabase } from '@/lib/db'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { z } from 'zod'

const patchAssignmentSchema = z.object({
  agent_id: z.number().int().positive(),
  role: z.enum(['member', 'lead']),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const teamId = Number.parseInt(id, 10)
  if (Number.isNaN(teamId)) return NextResponse.json({ error: 'Invalid team id' }, { status: 400 })

  const validated = await validateBody(request, patchAssignmentSchema)
  if ('error' in validated) return validated.error

  const { agent_id, role } = validated.data
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  // Verify agent is a member of this team
  const existing = db.prepare(
    `SELECT id FROM agent_team_assignments WHERE workspace_id = ? AND agent_id = ? AND team_external_id = ?`
  ).get(workspaceId, agent_id, teamId)
  if (!existing) return NextResponse.json({ error: 'Agent is not a member of this team' }, { status: 422 })

  db.transaction(() => {
    if (role === 'lead') {
      // Demote any existing lead
      db.prepare(
        `UPDATE agent_team_assignments SET role = 'member', source = 'manual'
         WHERE workspace_id = ? AND team_external_id = ? AND role = 'lead'`
      ).run(workspaceId, teamId)
    }
    db.prepare(
      `UPDATE agent_team_assignments SET role = ?, source = 'manual'
       WHERE workspace_id = ? AND agent_id = ? AND team_external_id = ?`
    ).run(role, workspaceId, agent_id, teamId)
  })()

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json({ ok: true })
}
```

### Pattern 2: Zustand Action — API First, State on Success

**What:** Call fetch → on success update local state; on failure optionally revert optimistic update.
**When to use:** D-03 is explicit: no optimistic local update before API confirms. Keep it simple: update after success only.

```typescript
// Pattern: call API, then on success call existing setAgentTeamAssignments
assignAgentToTeam: async (agentId, teamId, role) => {
  // API call first (D-03)
  try {
    const response = await fetch(`/api/teams/${teamId}/assignments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, role }),
    })
    if (!response.ok) throw new Error(await response.text())
  } catch (err) {
    console.error('Failed to update assignment role', err)
    return // do not update local state
  }

  // Update local state on success (mirrors existing store logic)
  set((state) => {
    const filtered = state.agentTeamAssignments.filter(
      (a) => !(role === 'lead' && a.team_id === teamId && a.role === 'lead') &&
              !(a.agent_id === agentId && a.team_id === teamId)
    )
    return {
      agentTeamAssignments: [...filtered, { agent_id: agentId, team_id: teamId, role, assigned_at: Math.floor(Date.now() / 1000) }]
    }
  })
}
```

### Pattern 3: Department Lead DB Migration

**What:** Add `manager_agent_id INTEGER` column to the `departments` table.

```typescript
// In src/lib/migrations.ts — new entry appended to extraMigrations
{
  id: '050_departments_manager_agent_id',
  up(db: Database.Database) {
    db.exec(`ALTER TABLE departments ADD COLUMN manager_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL`)
  }
}
```

### Pattern 4: Org Scanner Source Priority Fix

**What:** The `upsertAssignment` in `applyFilesystemOrgPersistence` must not overwrite `role` or `source` if the existing record has `source = 'manual'`.

**Current (broken) SQL:**
```sql
ON CONFLICT(workspace_id, agent_id, team_external_id) DO UPDATE SET
  role = excluded.role,
  assigned_at = excluded.assigned_at,
  source = excluded.source
```

**Fixed SQL:**
```sql
ON CONFLICT(workspace_id, agent_id, team_external_id) DO UPDATE SET
  role = CASE WHEN agent_team_assignments.source = 'manual' THEN agent_team_assignments.role ELSE excluded.role END,
  assigned_at = excluded.assigned_at,
  source = CASE WHEN agent_team_assignments.source = 'manual' THEN 'manual' ELSE excluded.source END
```

This preserves manually-set roles and their source marker when the filesystem scanner runs.

Similarly, for `departments` upsert: once `manager_agent_id` is added, the upsert must not touch `manager_agent_id` at all (filesystem source never sets it).

### Anti-Patterns to Avoid
- **Updating local Zustand state before API call:** D-03 requires API-first. Store mutations must wait for success response.
- **Adding `manager_agent_id` to the org scanner's department upsert:** The column belongs to the manual/API domain only; filesystem scanning never sets it.
- **Calling `getOrgSnapshot()` from the new API routes to return updated data:** The snapshot is a cached in-memory structure. After writing to DB, call `invalidateOrgSnapshot()` and return a simple `{ ok: true }` — the client will refresh via the existing `useOrgData` hook.
- **Not demoting the old lead in a transaction:** The single-lead constraint (D-14) requires the demotion and promotion to happen atomically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request body parsing and error responses | Custom JSON.parse + manual error shaping | `validateBody` from `@/lib/validation` | Already established, returns typed `{ data }` or `{ error: NextResponse }` |
| Auth enforcement | Custom session check | `requireRole(request, 'operator')` | Single auth guard used by every mutating route |
| DB singleton | New DB connection | `getDatabase()` from `@/lib/db` | better-sqlite3 must be a singleton; this already handles it |
| Cache invalidation | Manual cache.snapshots.delete | `invalidateOrgSnapshot(workspaceId)` | Already exported from org-scanner |

**Key insight:** All the plumbing (auth, validation, DB, cache) is already built. The new routes are thin orchestrators calling existing helpers.

---

## Common Pitfalls

### Pitfall 1: `manager_agent_id` Is Not In the DB Schema Yet

**What goes wrong:** The `Department` TypeScript type has `manager_agent_id?: number`, but migration 049 (`049_org_sync_tables`) does NOT include this column in the `CREATE TABLE departments` DDL. Any SQL that tries to read or write `manager_agent_id` will throw a SQLite error at runtime.

**Why it happens:** The TS type was defined in the store in anticipation; the DB schema was not updated to match.

**How to avoid:** Add migration `050_departments_manager_agent_id` (`ALTER TABLE departments ADD COLUMN manager_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL`) before any route that touches this field.

**Warning signs:** SQLite error "table departments has no column named manager_agent_id" at runtime.

### Pitfall 2: Filesystem Scanner Overwrites Manual Promotions

**What goes wrong:** When `AGENTS_DIR` is configured and the watcher fires (or a forced rescan is triggered), `applyFilesystemOrgPersistence` runs and its `upsertAssignment` overwrites `role = 'member'` for any agent the filesystem says is a member — even agents the user just promoted via the API.

**Why it happens:** The current upsert has no source priority guard: `DO UPDATE SET role = excluded.role`. The scanner always says `role = metadata.assignmentRole || 'member'`.

**How to avoid:** Apply the `CASE WHEN source = 'manual'` guard shown in Pattern 4. This is a required fix for D-03 to hold after a rescan.

**Warning signs:** Promotions disappear after navigating away and back (triggers a rescan); the lead slot returns to "Unassigned" in the chat tab.

### Pitfall 3: `isReadOnly` Blocks All Mutations

**What goes wrong:** `useOrgData()` returns `isReadOnly: true` when `orgSource === 'filesystem'`. The existing `handleSetLead` and `handleAddMembers` in teams-panel guard on `isReadOnly`. If the panels respect `isReadOnly`, the promote button will be hidden for filesystem-sourced orgs.

**Why it happens:** The existing read-only guard was a reasonable default before API persistence existed. Now that we have API-backed mutations, filesystem-sourced orgs should still allow manual promotions.

**How to avoid:** After the new API routes are in place, the `isReadOnly` check in `handleSetLead` (and in the new department lead setter) should be removed or scoped only to operations that truly cannot persist (e.g., team creation, which still has no API backing). The new API calls succeed regardless of `orgSource`.

**Warning signs:** The "promote" button and department lead selector are absent when `AGENTS_DIR` is configured.

### Pitfall 4: Store `assignAgentToTeam` Is Currently Synchronous — Making It Async Breaks `handleSetLead`

**What goes wrong:** `handleSetLead` calls `assignAgentToTeam` twice synchronously (demote old lead, then promote new). If `assignAgentToTeam` becomes async, the second call may fire before the first one is persisted.

**Why it happens:** The current implementation is a pure Zustand state update (sync). Converting to async API-first requires the caller to await the first call before making the second, or the API must handle the full single-lead promotion atomically.

**How to avoid:** Make the API handle atomicity (transaction demotes old + promotes new in one call). The store action for "set lead" becomes a single PATCH call with `{ agent_id, role: 'lead' }`, and the API route handles the demotion internally. This simplifies the client: one call, one state update.

**Warning signs:** Race condition where two assignments with `role = 'lead'` exist briefly in the DB.

### Pitfall 5: `getOrgSnapshot()` Returns Stale `manager_agent_id` Until Cache Invalidation

**What goes wrong:** After a successful `PUT /api/departments/:id/lead`, the `useOrgData` hook calls `loadSnapshot()` which calls `GET /api/org/scan`. If the org snapshot cache was not invalidated before the GET returns, the response won't include the updated `manager_agent_id`.

**Why it happens:** `getOrgSnapshot()` returns the cached in-memory snapshot. The DB was updated but the cache was not refreshed.

**How to avoid:** The `PUT /api/departments/:id/lead` route must call `invalidateOrgSnapshot(workspaceId)` before returning. The client should then call `GET /api/org/scan?force=true` or the SSE stream should trigger a refresh. Given the existing `org-update` event approach, emitting an org event or simply returning and relying on the next client poll with `force=true` are both valid.

---

## Code Examples

### PATCH /api/teams/[id]/assignments — full skeleton

```typescript
// src/app/api/teams/[id]/assignments/route.ts
// Source: project pattern from src/app/api/agents/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { getDatabase } from '@/lib/db'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { z } from 'zod'

const patchSchema = z.object({
  agent_id: z.number().int().positive(),
  role: z.enum(['member', 'lead']),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const teamExternalId = Number.parseInt(id, 10)
  if (Number.isNaN(teamExternalId)) {
    return NextResponse.json({ error: 'Invalid team id' }, { status: 400 })
  }

  const validated = await validateBody(request, patchSchema)
  if ('error' in validated) return validated.error

  const { agent_id, role } = validated.data
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const existing = db.prepare(
    `SELECT id FROM agent_team_assignments
     WHERE workspace_id = ? AND agent_id = ? AND team_external_id = ?`
  ).get(workspaceId, agent_id, teamExternalId)

  if (!existing) {
    return NextResponse.json(
      { error: 'Agent is not a member of this team' },
      { status: 422 }
    )
  }

  db.transaction(() => {
    if (role === 'lead') {
      db.prepare(
        `UPDATE agent_team_assignments
         SET role = 'member', source = 'manual'
         WHERE workspace_id = ? AND team_external_id = ? AND role = 'lead' AND agent_id != ?`
      ).run(workspaceId, teamExternalId, agent_id)
    }
    db.prepare(
      `UPDATE agent_team_assignments
       SET role = ?, source = 'manual'
       WHERE workspace_id = ? AND agent_id = ? AND team_external_id = ?`
    ).run(role, workspaceId, agent_id, teamExternalId)
  })()

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json({ ok: true })
}
```

### PUT /api/departments/[id]/lead — full skeleton

```typescript
// src/app/api/departments/[id]/lead/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { getDatabase } from '@/lib/db'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { z } from 'zod'

const putLeadSchema = z.object({
  // null to unset the lead
  agent_id: z.number().int().positive().nullable(),
})

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const deptExternalId = Number.parseInt(id, 10)
  if (Number.isNaN(deptExternalId)) {
    return NextResponse.json({ error: 'Invalid department id' }, { status: 400 })
  }

  const validated = await validateBody(request, putLeadSchema)
  if ('error' in validated) return validated.error

  const { agent_id } = validated.data
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const result = db.prepare(
    `UPDATE departments SET manager_agent_id = ?, updated_at = unixepoch()
     WHERE workspace_id = ? AND external_id = ?`
  ).run(agent_id, workspaceId, deptExternalId)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  invalidateOrgSnapshot(workspaceId)
  return NextResponse.json({ ok: true })
}
```

### Org-Scanner Upsert Fix

```typescript
// src/lib/org-scanner.ts — replace upsertAssignment prepare statement
const upsertAssignment = db.prepare(`
  INSERT INTO agent_team_assignments (
    workspace_id, agent_id, team_external_id, role, assigned_at, source
  ) VALUES (?, ?, ?, ?, ?, 'filesystem')
  ON CONFLICT(workspace_id, agent_id, team_external_id) DO UPDATE SET
    role = CASE WHEN agent_team_assignments.source = 'manual' THEN agent_team_assignments.role ELSE excluded.role END,
    assigned_at = excluded.assigned_at,
    source = CASE WHEN agent_team_assignments.source = 'manual' THEN 'manual' ELSE excluded.source END
`)
```

### `getOrgSnapshot` Must Propagate `manager_agent_id`

The `scanFilesystemOrg` function builds `Department` objects without `manager_agent_id`. After the DB write exists, the org scan endpoint must read `manager_agent_id` from the DB and merge it into the snapshot departments. The simplest approach: after `applyFilesystemOrgPersistence`, do a SELECT to read back `manager_agent_id` per department and annotate the snapshot before caching.

```typescript
// After syncTxn() and applyFilesystemOrgPersistence(), in scanFilesystemOrg:
const leadRows = db.prepare(
  `SELECT external_id, manager_agent_id FROM departments WHERE workspace_id = ?`
).all(workspaceId) as Array<{ external_id: number; manager_agent_id: number | null }>

const leadMap = new Map(leadRows.map((row) => [row.external_id, row.manager_agent_id]))
for (const dept of departments) {
  const leadId = leadMap.get(dept.id)
  if (leadId != null) dept.manager_agent_id = leadId
}
```

This ensures `manager_agent_id` survives a rescan and reaches the client through `useOrgData`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Store-only `assignAgentToTeam` (pure sync state update) | API-first with DB persistence + store update on success | This phase | Promotions survive page reload and server restart |
| `manager_agent_id` as TypeScript-only field (never persisted) | DB column + API route to persist it | This phase | Department chat tab resolves lead reliably |
| Scanner overwrites all assignments on rescan | Scanner respects `source = 'manual'` assignments | This phase | Manual promotions survive automatic org rescans |

---

## Open Questions

1. **Should the `assignAgentToTeam` Zustand action itself be converted to async, or should a new wrapper action handle the API call?**
   - What we know: The current action is synchronous and used in multiple places (handleAddMembers also calls it with 'member'). Making it async ripples to callers.
   - What's unclear: Whether `handleAddMembers` should also hit the API (adding members is currently store-only too).
   - Recommendation: Add a separate `promoteToLead(agentId, teamId)` async action that calls the new PATCH endpoint and updates local state. Leave the synchronous `assignAgentToTeam` for in-session member additions that don't need persistence yet. The planner should decide scope.

2. **What triggers the client to refresh after a lead change?**
   - What we know: `useOrgData` uses SSE (`/api/org/stream`) and polls on `org-update` events. After `invalidateOrgSnapshot`, the next GET call returns fresh data.
   - What's unclear: Whether the SSE stream broadcasts an `org-update` event after the API invalidates the snapshot, or whether the client needs to poll explicitly.
   - Recommendation: The promotion response can include `{ ok: true }` and the client store action can call `GET /api/org/scan?force=true` after success to guarantee a refresh. This is simpler than relying on SSE propagation.

3. **Where does the department lead selector component live?**
   - What we know: D-11 says "dropdown or agent picker" in the department overview tab. `AgentMultiSelect` exists but is multi-select (for adding members). A single-agent selector needs a different UX.
   - Recommendation: A simple `<select>` element listing agents (with an "Unassigned" first option) in the overview tab, similar in style to the department filter select in the teams sidebar.

---

## Environment Availability

Step 2.6: SKIPPED — no external dependencies beyond the project's own code. All tools (Node.js, pnpm, SQLite) are in use by Phase 1 already.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts) |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test --run` |
| Full suite command | `pnpm test:all` |

### Phase Requirements → Test Map

| ID | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| — | `PATCH /api/teams/:id/assignments` persists role change | unit (route) | `pnpm test --run src/lib/__tests__/team-assignment-route.test.ts` | Wave 0 |
| — | `PATCH` returns 422 when agent not a member | unit (route) | same file | Wave 0 |
| — | `PATCH` demotes existing lead atomically | unit (route) | same file | Wave 0 |
| — | `PUT /api/departments/:id/lead` persists manager_agent_id | unit (route) | `pnpm test --run src/lib/__tests__/department-lead-route.test.ts` | Wave 0 |
| — | Org scanner upsert does not overwrite manual source | unit | `pnpm test --run src/lib/__tests__/org-scanner-source-priority.test.ts` | Wave 0 |
| — | `manager_agent_id` propagates through getOrgSnapshot | unit | same file | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test --run`
- **Per wave merge:** `pnpm test:all`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/team-assignment-route.test.ts` — covers PATCH route behavior, 422 guard, single-lead constraint
- [ ] `src/lib/__tests__/department-lead-route.test.ts` — covers PUT route, 404 guard, manager_agent_id persistence
- [ ] `src/lib/__tests__/org-scanner-source-priority.test.ts` — covers upsert CASE logic, manager_agent_id annotation

---

## Sources

### Primary (HIGH confidence)
- `src/lib/migrations.ts` (lines 1414–1474) — verified `049_org_sync_tables` DDL; confirmed `manager_agent_id` is absent from `departments` table
- `src/lib/org-scanner.ts` (lines 340–348) — confirmed unconditional upsert overwrite of `role` and `source`
- `src/lib/org-scanner.ts` (lines 517–524) — confirmed snapshot does not carry `manager_agent_id` back to client
- `src/lib/use-org-data.ts` — confirmed org data flows exclusively through `getOrgSnapshot()` → `/api/org/scan`
- `src/components/panels/teams-panel.tsx` — confirmed `handleSetLead` is store-only, `isReadOnly` guard present
- `src/components/panels/departments-panel.tsx` (lines 136–138) — confirmed `leadAgent` resolved from `dept.manager_agent_id` (which is always undefined currently)
- `src/app/api/agents/route.ts` — confirmed project API route pattern: `requireRole` + `validateBody` + `getDatabase`
- `src/lib/validation.ts` — confirmed `validateBody` signature and Zod-based validation
- `src/store/index.ts` (lines 78–104, 638–658) — confirmed type shapes and existing store actions

### Secondary (MEDIUM confidence)
- `vitest.config.ts` — test framework configuration verified directly

---

## Project Constraints (from CLAUDE.md)

- **Package manager:** pnpm only (no npm/yarn)
- **Commits:** Conventional Commits format (`feat:`, `fix:`, etc.)
- **No AI attribution:** No `Co-Authored-By` trailers in commits
- **No icon libraries:** Use raw text/emoji only
- **Path alias:** `@/*` maps to `./src/*`
- **Standalone output:** `next.config.js` sets `output: 'standalone'` — no impact on this phase
- **Tests:** `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in-codebase, no new packages needed
- Architecture: HIGH — all patterns verified against existing source files
- Pitfalls: HIGH — each pitfall traced to concrete code evidence (migration DDL, scanner upsert SQL, isReadOnly guard)
- DB schema gap (manager_agent_id): HIGH — confirmed by reading migrations.ts line by line; no migration for this column exists

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable internal codebase; no external library changes expected)
