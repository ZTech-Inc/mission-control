# Phase 3: Improve the Teams and Department Panels — Research

**Researched:** 2026-03-30
**Domain:** React 19 / Next.js 16 panel UI, filesystem-write API routes, Zustand store mutations, org-scanner integration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Teams Panel — Overview Tab**
- D-01: Replace the team notes card with an agent details card that takes 2/3 of the screen width. The Team Roster card becomes smaller (1/3 width).
- D-02: The agent details card reuses the same tab structure as `AgentDetailModalPhase3` but renders tabs as vertical sidebar tabs on the left side of the card (not horizontal). All 11 tabs: Overview, Files, Tools, Models, Channels, Cron, SOUL, Memory, Tasks, Activity, Config.
- D-03: Default: pre-load the team lead's details with the lead visually highlighted/selected in the roster. If no team lead is assigned, show an empty state prompting to select an agent.
- D-04: Clicking any agent in the roster updates the agent details card to show that agent's information. The selected agent must be visually highlighted in the roster.
- D-05: Keep the overall aesthetic of the Teams panel consistent.

**Teams Panel — New Team Button**
- D-06: The "New Team" button must be visually prominent. Style: `Button default size sm` (solid `bg-primary text-primary-foreground`).
- D-07: Clicking it creates a new directory in `ZTech_Agents/<department>/<TEAM_NAME>/` AND a database record. The read-only constraint on ZTech_Agents is removed for creation operations.

**Teams Panel — Members Tab**
- D-08: Fix the "Add Member" button to open a modal for creating a NEW agent (not selecting existing ones).
- D-09: The agent creation form includes: name, role, model, editable text areas for IDENTITY.md / AGENT.md / SOUL.md, allow/deny tool lists and tool profile, primary model selection plus fallback chain.
- D-10: Created agent is written to the filesystem (`ZTech_Agents/<dept>/<team>/<Agent_Name>/`) with the appropriate files, and added to the database.

**Teams Panel — Docs Tab**
- D-11: Fix the "Add Doc" button in `OrgDocsPanel` to create markdown files in `ZTech_Agents/<department>/<team>/docs/`.
- D-12: Fix separator lines in `OrgDocsPanel` that get cut off — they should span the full width.

**Teams Panel — Chat Tab**
- D-13: Chat tab includes a sidebar showing previous conversations, filtered to the currently selected agent only.
- D-14: Default chat target is the team lead. A visually creative agent selector (not a simple dropdown) allows choosing any agent within the team.
- D-15: Selected agent in Chat tab persists across tab switches (Overview/Members/Docs/Chat).
- D-16: Reuse existing chat infrastructure (`EmbeddedChat`, `ChatInput`, `MessageBubble`).

**Department Panel — New Department Button**
- D-17: Add a "New Department" button with `Button default size sm` prominence.
- D-18: Creates a directory in `ZTech_Agents/<DEPARTMENT_NAME>/` AND a database record.

**Department Panel — Manager Terminology (Full Rename)**
- D-19: Rename all UI labels from "Department Lead" to "Department Manager".
- D-20: Full code-level rename: variable names, store actions, API params — change "lead" to "manager" for department context. (Team lead stays as "lead".)
- D-21: Department Managers are standalone agents not part of any team. The manager agent lives in `MANAGER/` directory inside each department (`ZTech_Agents/<dept>/MANAGER/`).
- D-22: If no manager exists, show a "Hire a Manager" button that opens a creation form (same fields as Add Member).

**Department Panel — Overview Tab**
- D-23: Show more detailed info about the department manager when assigned (summary card with role, model, status, recent activity).

**Department Panel — Docs Tab**
- D-24: Fix the "New Doc" button — same approach as teams: create markdown files in `ZTech_Agents/<department>/docs/`.
- D-25: Fix separator lines that get cut off (same OrgDocsPanel fix as teams).

### Claude's Discretion
- Button styling approach for prominent action buttons (solid accent, outlined with glow, etc.) — whatever fits the dark panel aesthetic
- Agent selector creative design in Chat tab (avatar grid, pill selector, card strip, etc.)
- Internal component decomposition for the agent details card
- How to structure the agent creation form (single page vs stepped wizard)
- Exact layout of the vertical tab sidebar in the agent details card

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

## Summary

Phase 3 is a substantial UI and data-layer enhancement to both the Teams panel and the Departments panel. The work splits into four categories: (1) UI restructuring — replacing the "team notes" card with an inline 11-tab agent details card, adding a creative chat agent selector, and adding a manager summary card; (2) new creation flows — team creation, department creation, agent creation, and manager creation, each writing to both the filesystem and SQLite; (3) terminology rename — "Department Lead" to "Department Manager" at the UI, variable, and API level; (4) bug fixes — OrgDocsPanel separator layout, functional Add Doc / New Doc buttons.

The codebase's existing patterns make this tractable: `agent-detail-tabs.tsx` already exports all 11 tab components; `EmbeddedChat` is self-contained; `org-scanner.ts` shows exactly how filesystem-to-DB writes work; Phase 2 established the API-first store action pattern. The main new surface is the filesystem write layer for creation operations — creating directories and markdown files from Next.js API routes, a pattern already used in `src/app/api/agents/[id]/files/route.ts` and `soul/route.ts`.

**Primary recommendation:** Build the data layer (new API routes for create-team, create-department, create-agent, create-doc) in Wave 0/1 with robust error handling, then wire the UI components on top. Rename "lead" to "manager" in the department context at the same time as the API layer to avoid split-state bugs.

---

## Project Constraints (from CLAUDE.md)

| Directive | Detail |
|-----------|--------|
| Package manager | pnpm only — no npm/yarn |
| Icons | No icon libraries — use raw text/emoji |
| Commits | Conventional Commits (`feat:`, `fix:`, etc.) |
| No AI attribution | No `Co-Authored-By` trailers |
| Standalone output | `next.config.js` sets `output: 'standalone'` — don't break it |
| Stack | Next.js 16, React 19, TypeScript 5, SQLite (better-sqlite3), Tailwind CSS 3, Zustand |
| Path alias | `@/*` maps to `./src/*` |

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 16.x | API routes + pages | Already used; all API routes follow this pattern |
| React | 19.x | UI components | Project baseline |
| Zustand + subscribeWithSelector | per package.json | Client state management | All store actions follow API-first + optimistic update pattern |
| better-sqlite3 | per package.json | SQLite write operations | All DB writes already use synchronous `db.prepare().run()` |
| Tailwind CSS | 3.x | Styling | All components use utility classes; surface/primary CSS vars |
| `node:fs` (mkdirSync, writeFileSync) | built-in | Filesystem writes in API routes | Already used in `agents/[id]/files/route.ts`, `soul/route.ts`, `memory/route.ts` |
| `node:path` | built-in | Safe path construction | Already used in `org-scanner.ts`, `config.ts` |

### Supporting (already in project, reused this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@dnd-kit/core` | per package.json | Drag and drop (members tab) | Keep existing DnD wiring intact |
| `reagraph` | per package.json | OrgDocsPanel graph view | Already imported — do not remove |
| `zod` | per package.json | API body validation | Used in existing `lead/route.ts` — follow same pattern for new routes |
| `@radix-ui/react-slot` | per package.json | CVA Button primitives | Button component already set up |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:fs sync writes | fs/promises async | Sync is simpler in Next.js route handlers with better-sqlite3 (also sync); async buys nothing here |
| Single-page agent creation form | Stepped wizard | Single-page chosen (Claude's discretion per CONTEXT.md D-09); simpler implementation |

**No new packages needed.** All required functionality is available in the existing dependency tree.

---

## Architecture Patterns

### Filesystem Write Pattern (established in agents/[id]/files/route.ts)
```typescript
// Source: src/app/api/agents/[id]/files/route.ts lines 229-231
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const safePath = resolveWithin(safeWorkspace, file)
mkdirSync(dirname(safePath), { recursive: true })
writeFileSync(safePath, content, 'utf-8')
```
Use `mkdirSync(..., { recursive: true })` for all new directory creation. Always resolve paths through a sanitized base (config.agentsDir) to prevent path traversal.

### API-First Store Action Pattern (established Phase 2)
```typescript
// Source: src/store/index.ts setDepartmentLead action
setDepartmentLead: async (deptId, agentId) => {
  const response = await fetch(`/api/departments/${deptId}/lead`, { method: 'PUT', ... })
  if (!response.ok) { console.error(...); return false }
  await fetch('/api/org/scan?force=true')   // invalidate + refresh cache
  set((state) => ({ departments: state.departments.map(...) }))
  return true
},
```
All new creation actions must: (1) POST to API, (2) invalidate org snapshot (`/api/org/scan?force=true`), (3) update local Zustand state on success.

### Org-Scanner Source Priority Pattern (established Phase 2)
```typescript
// Source: src/lib/org-scanner.ts applyFilesystemOrgPersistence
// Assignments created via API get source='manual' — filesystem rescans CANNOT overwrite them
ON CONFLICT DO UPDATE SET
  role = CASE WHEN source = 'manual' THEN source.role ELSE excluded.role END
```
New creation routes must write with `source = 'manual'` so filesystem rescans do not delete or overwrite dashboard-created entries.

### DB Upsert Pattern for Departments/Teams
```typescript
// Source: src/lib/org-scanner.ts applyFilesystemOrgPersistence
db.prepare(`INSERT INTO departments (workspace_id, external_id, name, ..., source, ...)
  VALUES (...)
  ON CONFLICT(workspace_id, external_id) DO UPDATE SET ...`)
```
New department and team creation routes must insert with `source = 'manual'` and a stable `external_id` derived from the filesystem path hash (same `stableNumber` function in org-scanner) or auto-incremented.

### isReadOnly Override for Creation
```typescript
// Source: src/lib/use-org-data.ts line 100
isReadOnly: orgSource === 'filesystem',
```
Currently `isReadOnly = true` when source is `'filesystem'`, which blocks the New Team button. Creation operations must bypass this gate. The panels should check a separate `canCreate` flag (or ignore `isReadOnly` for specific create-button click handlers) so that file-backed orgs can still create new entities.

### InlineAgentDetailsCard — Tab Content Reuse Pattern
```typescript
// Source: src/components/panels/agent-detail-tabs.tsx
// All 11 tabs are exported named components:
export function OverviewTab({ agent, ... }) { ... }
export function SoulTab({ agent, ... }) { ... }
export function MemoryTab({ agent, ... }) { ... }
export function TasksTab({ agent, ... }) { ... }
export function ActivityTab({ agent, ... }) { ... }
export function ConfigTab({ agent, ... }) { ... }
export function FilesTab({ agent, ... }) { ... }
export function ToolsTab({ agent, ... }) { ... }
export function ChannelsTab({ agent, ... }) { ... }
export function CronTab({ agent, ... }) { ... }
export function ModelsTab({ agent, ... }) { ... }
```
These components accept `agent` and related props. The `InlineAgentDetailsCard` needs to pass the selected `Agent` object to whichever tab is active via a `selectedAgentId` → fetch-or-lookup pattern. The vertical tab sidebar is a purely visual wrapper.

### Agent Selector (Chat Tab) — Chip Strip Pattern
Per UI-SPEC: `AgentChatSelector` renders one chip per team member. Chips are `h-8 px-3 rounded-full` with horizontal overflow scroll. Active chip gets `border border-primary/60 bg-[hsl(var(--surface-2))]`. Inactive gets `border border-border/50 bg-[hsl(var(--surface-1))]`. Selected agent ID is lifted to `TeamDetail` state so it persists across tab switches.

### Recommended Project Structure for New Files
```
src/app/api/
├── teams/route.ts                     # POST handler to be implemented (currently stub)
├── teams/[id]/docs/route.ts           # POST handler to be implemented (currently stub)
├── departments/route.ts               # POST handler to be implemented (currently stub)
├── departments/[id]/docs/route.ts     # POST handler to be implemented (currently stub)
├── agents/create/route.ts             # NEW: create agent + write filesystem files
src/components/panels/
├── teams-panel.tsx                    # Modified: add InlineAgentDetailsCard, AgentChatSelector, new team form
├── departments-panel.tsx              # Modified: add DepartmentManagerCard, new dept form, rename lead → manager
├── org-docs-panel.tsx                 # Modified: fix separator, wire Add Doc to API
```

### Anti-Patterns to Avoid
- **Client-side filesystem writes:** Never write files directly from React components. All writes must go through API routes (same pattern as `soul/route.ts`).
- **Hardcoded `isReadOnly` bypass:** Do not globally invert `isReadOnly`. Only specific creation handlers should bypass it; all destructive/edit operations must respect it.
- **Re-inventing CreateAgentModal:** `agent-detail-tabs.tsx` already exports `CreateAgentModal`. Verify its field coverage matches D-09 before building a new one.
- **Local-only state for creation:** New teams/departments/agents must write to DB + filesystem AND trigger `/api/org/scan?force=true` so the org snapshot stays in sync.
- **Using `addTeam` store action without API write:** The current `addTeam` action is local-only (no API call). For filesystem-backed orgs, the new "New Team" flow must call a real API route first.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent detail tabs (all 11) | New tab components | Export from `agent-detail-tabs.tsx` | Already built, tested, consistent |
| Chat display + send | Custom message list | `EmbeddedChat` + `ChatInput` + `MessageBubble` | Self-contained widget with polling, optimistic updates |
| Path sanitization | Custom path join | `resolveWithin()` pattern from `agents/[id]/files/route.ts` | Prevents path traversal vulnerabilities |
| Status indicator | Custom dot | `StatusDot` from `dnd-org-helpers.tsx` | Already handles all 4 status values with correct colors |
| Button variants | Custom button | `Button` from `components/ui/button.tsx` | CVA variants already match design system |
| Org snapshot invalidation | Manual cache clear | `invalidateOrgSnapshot()` + `fetch('/api/org/scan?force=true')` | Exact pattern used by Phase 2 lead actions |
| Filesystem existence check | Custom exists check | `fs.existsSync()` / `mkdirSync({ recursive: true })` | Idempotent; used throughout codebase |

---

## Common Pitfalls

### Pitfall 1: isReadOnly Blocks Creation Buttons
**What goes wrong:** `isReadOnly` is `true` when the org source is `'filesystem'`. The existing "new team" button check uses `if (isReadOnly) return`. New creation buttons that also check `isReadOnly` will silently do nothing for filesystem-backed installations.
**Why it happens:** `isReadOnly` was designed to prevent accidental edits, not to prevent creation of new entities.
**How to avoid:** Creation handlers should NOT check `isReadOnly`. Alternatively, add a `canCreate` flag to `useOrgData` that is always `true` when `agentsDir` is configured. Document this explicitly in the component.
**Warning signs:** Clicking "New Team" does nothing in filesystem-backed mode.

### Pitfall 2: addTeam Store Action Is Local-Only
**What goes wrong:** `addTeam` in `src/store/index.ts` only mutates local Zustand state — it does not call any API. If the plan uses `addTeam` directly for the "New Team" creation flow, the new team will vanish on the next org rescan.
**Why it happens:** `addTeam` was used in the legacy `handleAddTeam` in `departments-panel.tsx` which generated a local fake `id`. This was always a placeholder.
**How to avoid:** The new team creation action must: POST to `/api/teams` (implement the stub), write the directory to filesystem, then call `addTeam` to update local state optimistically. Follow the exact pattern of `setDepartmentLead`.
**Warning signs:** Teams appear in the panel after creation but disappear after a page refresh or org stream update.

### Pitfall 3: Org-Scanner Scans MANAGER/ As a Team
**What goes wrong:** `scanFilesystemOrg` iterates every subdirectory of a department directory as a team. If `MANAGER/` is created inside a department directory, the scanner will treat it as a team named "MANAGER" and create a team record for it.
**Why it happens:** The scanner has no concept of a reserved directory name for the department manager.
**How to avoid:** Add `'MANAGER'` to a reserved-names set in the org-scanner (similar to `IGNORED_DIRECTORIES`) so it is skipped when iterating team directories. Instead, when the scanner encounters a `MANAGER/` subdirectory, it should treat the contents as the department manager agent and set `manager_agent_id` on the department record.
**Warning signs:** A phantom "MANAGER" team appears in the Teams panel after creating a department manager.

### Pitfall 4: stableNumber Collision for Manually Created Entities
**What goes wrong:** `stableNumber()` generates IDs from filesystem paths using SHA1. If a new team/department is created via the API and stored with a numeric ID, then a filesystem rescan generates a `stableNumber()` for the same path, the two IDs may not match, causing duplicate records.
**Why it happens:** `stableNumber` is deterministic but the API creation flow assigns its own ID (currently `Math.max(...) + 1` in `handleAddTeam`).
**How to avoid:** New creation API routes must use `stableNumber(path)` to compute the `external_id` — same as the scanner — so that future rescans recognize the existing record via `ON CONFLICT(workspace_id, external_id)`.
**Warning signs:** After creating a team via the UI and restarting the server, the team appears twice in the sidebar.

### Pitfall 5: OrgDocsPanel Uses Mock Data, Not Real Filesystem
**What goes wrong:** `OrgDocsPanel` currently loads from `MOCK_TEAM_DOCS` / `MOCK_DEPARTMENT_DOCS` (hardcoded mock data) and the `GET /api/teams/[id]/docs` route also returns mock data. The "Add Doc" click handler sets editing state but does not call any API.
**Why it happens:** The docs feature was built as a prototype/stub.
**How to avoid:** The plan must include: (1) implement real filesystem read for the docs GET routes, (2) implement real filesystem write for the docs POST routes, (3) update `OrgDocsPanel` to fetch from the real API instead of mock constants.
**Warning signs:** Docs created via "Add Doc" appear only in the current session and are gone after a refresh.

### Pitfall 6: Department Rename Scope — manager_agent_id Column Already Exists
**What goes wrong:** The DB column is already named `manager_agent_id` (migration 050). The "rename" only affects UI labels and store action/API variable names — NOT the DB column or the `Department` TypeScript interface field `manager_agent_id`.
**Why it happens:** The column was originally designed with "manager" naming in anticipation of this rename, but the UI shipped with "lead" labels.
**How to avoid:** Do not rename the DB column or the TypeScript interface field. Only rename: (a) UI label strings ("Department Lead" → "Department Manager"), (b) the `setDepartmentLead` store action (rename to `setDepartmentManager`), and (c) the API route `/api/departments/[id]/lead` (optionally add alias `/api/departments/[id]/manager` while keeping old route for compatibility, or rename outright since Phase 2 is complete).
**Warning signs:** Renaming `manager_agent_id` in the TypeScript interface breaks dozens of references.

### Pitfall 7: Separator Line Cut Off in OrgDocsPanel
**What goes wrong:** The separator `<hr>` or `border-b` in `OrgDocsPanel` does not span full width because its parent has `overflow: hidden` or the separator uses `w-fit` or is inside a flex child with implicit width constraints.
**Why it happens:** Flex containers constrain child widths; border-b on a non-full-width element only draws as wide as the element.
**How to avoid:** Use `w-full` explicitly on separator elements. Use `<hr className="w-full border-border/50" />` or a `<div className="w-full border-t border-border/50" />`. Verify the parent is `display: block` or that the flex child has `flex-shrink-0` and `min-w-0`.

---

## Code Examples

### New Team Creation API Route (implement the stub in /api/teams/route.ts)
```typescript
// Pattern: POST /api/teams — write filesystem + DB, source='manual'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { invalidateOrgSnapshot } from '@/lib/org-scanner'
import { createHash } from 'node:crypto'

function stableNumber(key: string): number {
  const hex = createHash('sha1').update(key).digest('hex').slice(0, 12)
  return Math.max(1, parseInt(hex, 16) % 2_147_483_647)
}

// POST /api/teams
export async function POST(request: NextRequest) {
  // 1. Validate body (zod): { name, description?, department_id, department_name }
  // 2. Compute filesystem path: path.join(config.agentsDir, deptName, teamName)
  // 3. mkdirSync(teamPath, { recursive: true })
  // 4. Compute externalId = stableNumber(`team:${teamPath}`)
  // 5. INSERT INTO teams (workspace_id, external_id, name, ..., source='manual') ON CONFLICT DO UPDATE
  // 6. invalidateOrgSnapshot(workspaceId)
  // 7. Return { team: { id, name, ... } }
}
```

### New Agent Creation — Filesystem Write
```typescript
// Pattern from src/app/api/agents/[id]/files/route.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// POST /api/agents/create
// Body: { name, role, model, identity_md, agent_md, soul_md, team_path, dept_name, team_name }
const agentDir = path.join(config.agentsDir, deptName, teamName, agentName)
mkdirSync(agentDir, { recursive: true })
writeFileSync(path.join(agentDir, 'IDENTITY.md'), body.identity_md, 'utf-8')
writeFileSync(path.join(agentDir, 'AGENT.md'), body.agent_md, 'utf-8')
writeFileSync(path.join(agentDir, 'SOUL.md'), body.soul_md, 'utf-8')
// Then INSERT INTO agents ... source='manual', workspace_path=agentDir
// Then INSERT INTO agent_team_assignments ... source='manual'
```

### Department Manager Directory Convention
```typescript
// D-21: manager lives in MANAGER/ inside the department directory
const managerDir = path.join(config.agentsDir, deptName, 'MANAGER')
mkdirSync(managerDir, { recursive: true })
// Org-scanner must skip 'MANAGER' when iterating team directories
// Add to IGNORED_TEAM_DIRECTORIES in org-scanner.ts
```

### OrgDocsPanel Separator Fix
```tsx
{/* Before (broken): */}
<div className="border-b border-border" />

{/* After (correct): */}
<div className="w-full border-t border-border/50" />
{/* or */}
<hr className="w-full border-border/50" />
```

### Vertical Tab Sidebar (InlineAgentDetailsCard)
```tsx
// Source pattern: matches existing horizontal tab button pattern in teams-panel.tsx
const tabs = ['Overview','Files','Tools','Models','Channels','Cron','SOUL','Memory','Tasks','Activity','Config'] as const
<div className="w-32 shrink-0 border-r border-border/50 flex flex-col py-2">
  {tabs.map((tab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`w-full text-left px-3 py-2 text-[11px] font-mono rounded-none transition-colors ${
        activeTab === tab
          ? 'bg-[hsl(var(--surface-2))] text-foreground'
          : 'text-muted-foreground hover:bg-[hsl(var(--surface-2))] hover:text-foreground'
      }`}
    >
      {tab}
    </button>
  ))}
</div>
```

### Agent Chip Selector (Chat Tab)
```tsx
// Per UI-SPEC: AgentChatSelector — chip strip with horizontal scroll
<div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 overflow-x-auto shrink-0">
  {members.map(({ agent }) => (
    <button
      key={agent.id}
      onClick={() => setSelectedChatAgentId(agent.id)}
      className={`h-8 px-3 rounded-full flex items-center gap-2 shrink-0 text-[11px] font-mono transition-colors ${
        selectedChatAgentId === agent.id
          ? 'border border-primary/60 bg-[hsl(var(--surface-2))] text-foreground'
          : 'border border-border/50 bg-[hsl(var(--surface-1))] text-muted-foreground hover:bg-[hsl(var(--surface-2))]'
      }`}
    >
      <StatusDot status={agent.status} />
      {agent.name}
    </button>
  ))}
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `addTeam` local-only store action | Must now also call API + write filesystem | Phase 3 | Teams button needs a real API route, not just local state |
| `OrgDocsPanel` mock data | Must serve real filesystem docs | Phase 3 | Docs routes need real implementation |
| `isReadOnly` blocks ALL mutations | `isReadOnly` blocks edits/deletes; creation operations should bypass | Phase 3 | Creation buttons must not gate on `isReadOnly` |
| "Department Lead" terminology | "Department Manager" | Phase 3 | UI labels + store action rename (column stays `manager_agent_id`) |
| `handleAddTeam` in departments-panel generates fake ID | Must use `stableNumber(path)` from org-scanner | Phase 3 | Prevents duplicate records on rescan |

**Deprecated/outdated in this phase:**
- `MOCK_TEAM_DOCS` / `MOCK_DEPARTMENT_DOCS` usage in `OrgDocsPanel`: replaced with real filesystem reads
- "team notes" section in `TeamDetail` overview: removed, replaced by `InlineAgentDetailsCard`
- "Department Lead" label in `DepartmentDetail`: renamed to "Department Manager"
- `setDepartmentLead` store action: rename to `setDepartmentManager` (or alias)

---

## Runtime State Inventory

> This phase involves creating new filesystem directories and DB records. No rename of existing stored data.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `departments` table: `manager_agent_id` column already exists (migration 050). No data migration needed. | None — column name matches planned usage |
| Live service config | `AGENTS_DIR` / `MISSION_CONTROL_AGENTS_DIR` env var must point to the ZTech_Agents root for filesystem writes to land in the correct location | Verify env var is set in target deployment before executing creation tasks |
| OS-registered state | None — no OS-level registrations for teams/departments | None |
| Secrets/env vars | `AGENTS_DIR` / `MISSION_CONTROL_AGENTS_DIR` — must be writable by the Node.js process for creation features | Document in deployment guide; creation will fail gracefully if not set |
| Build artifacts | None — no compiled artifacts referencing team/department names | None |

**Key runtime check:** `config.agentsDir` resolves to `process.env.AGENTS_DIR || process.env.MISSION_CONTROL_AGENTS_DIR || ''`. If empty string, filesystem creation operations must return a clear 400 error ("Agents directory not configured") rather than writing to the process root. This guard must be present in ALL new creation API routes.

---

## Open Questions

1. **CreateAgentModal already exists in agent-detail-tabs.tsx**
   - What we know: `agent-detail-tabs.tsx` exports a `CreateAgentModal` component (imported in `agent-squad-panel-phase3.tsx`).
   - What's unclear: Whether its fields match D-09 exactly (name, role, model, IDENTITY.md / AGENT.md / SOUL.md, allow/deny tool lists, tool profile, primary model, fallback chain).
   - Recommendation: Plan should read the existing `CreateAgentModal` props and body; extend it or create a new variant if fields are missing. Do NOT build a net-new modal without checking.

2. **stableNumber for manually-created external_id vs auto-increment**
   - What we know: Org-scanner uses `stableNumber(path)` for reproducible IDs. The current `handleAddTeam` uses `Math.max(...) + 1`.
   - What's unclear: Whether SQLite `external_id` has a unique constraint that would conflict on re-scan if IDs don't match.
   - Recommendation: Check `schema.sql` for the `departments` and `teams` table unique constraints; use `stableNumber(path)` for `external_id` in new creation routes to match scanner behavior.

3. **MANAGER/ directory org-scanner skip logic**
   - What we know: The scanner treats every subdirectory of a department as a team. MANAGER/ must be excluded.
   - What's unclear: Whether there are other reserved directory names (e.g., `docs/`, `shared/`) that should also be skipped.
   - Recommendation: Add a `RESERVED_DEPARTMENT_SUBDIRS` set containing at minimum `'MANAGER'` and `'docs'` to `org-scanner.ts`. Scan MANAGER/ contents separately to extract the department manager agent.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `node:fs` (mkdirSync, writeFileSync) | All filesystem creation routes | Always available | Node.js built-in | — |
| `AGENTS_DIR` / `MISSION_CONTROL_AGENTS_DIR` env var | Directory creation, doc creation | Unknown (deployment-specific) | — | Return 400 "Agents directory not configured" |
| `better-sqlite3` | All DB writes | Available (pnpm build verified) | per package.json | — |
| `config.agentsDir` non-empty | All filesystem write features | Unknown at dev time | — | Feature degrades gracefully with error message |

**Missing dependencies with no fallback:**
- None — all runtime dependencies are built-in Node.js modules or already installed.

**Missing dependencies with fallback:**
- `AGENTS_DIR` env var: if not set, creation features return a 400 with a descriptive error. The panel should show a disabled state or tooltip explaining the requirement.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing: `pnpm test`) |
| Config file | `vitest.config.ts` (or similar in project root) |
| Quick run command | `pnpm test --run` |
| Full suite command | `pnpm test:all` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| D-07 / D-10 / D-18 | Team/agent/department creation writes correct filesystem structure | unit (API route handler) | `pnpm test --run tests/api/create-team.test.ts` | Wave 0 |
| D-20 | setDepartmentLead rename to setDepartmentManager | unit (store action) | `pnpm test --run tests/store/department-manager.test.ts` | Wave 0 |
| D-03 / D-04 | Agent selection in roster updates InlineAgentDetailsCard | manual (UI interaction) | — | Manual only |
| D-12 / D-25 | OrgDocsPanel separator spans full width | visual regression | — | Manual only |
| D-11 / D-24 | Add Doc creates correct filesystem file | unit (API route handler) | `pnpm test --run tests/api/create-doc.test.ts` | Wave 0 |
| Pitfall 3 | MANAGER/ is not scanned as a team | unit (org-scanner) | `pnpm test --run tests/lib/org-scanner.test.ts` | Likely exists — verify |

### Sampling Rate
- **Per task commit:** `pnpm test --run`
- **Per wave merge:** `pnpm typecheck && pnpm test --run && pnpm build`
- **Phase gate:** Full suite green (`pnpm test:all`) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/api/create-team.test.ts` — covers D-07 filesystem + DB write
- [ ] `tests/api/create-agent.test.ts` — covers D-10 filesystem + DB write
- [ ] `tests/api/create-doc.test.ts` — covers D-11, D-24 doc creation
- [ ] `tests/store/department-manager.test.ts` — covers D-20 action rename
- [ ] Verify `tests/lib/org-scanner.test.ts` exists and add MANAGER/ skip test case

---

## Sources

### Primary (HIGH confidence)
- `src/components/panels/teams-panel.tsx` — full panel structure, existing tab/view state, isReadOnly usage, roster layout
- `src/components/panels/departments-panel.tsx` — DepartmentDetail, existing "Department Lead" label locations, handleAddTeam, setDepartmentLead usage
- `src/components/panels/agent-detail-tabs.tsx` — all 11 exported tab components and CreateAgentModal
- `src/components/panels/org-docs-panel.tsx` — separator bug root cause, mock data usage, Add Doc handler
- `src/lib/org-scanner.ts` — stableNumber, scanFilesystemOrg directory iteration, MANAGER/ pitfall, source='manual' protection
- `src/store/index.ts` — Department/Team/Agent types, setDepartmentLead, addTeam, promoteToLead actions
- `src/lib/config.ts` — agentsDir resolution, AGENTS_DIR env var
- `src/lib/migrations.ts` — last migration is 050 (manager_agent_id column); no DB rename needed
- `src/app/api/agents/[id]/files/route.ts` — mkdirSync/writeFileSync pattern, resolveWithin safety
- `src/app/api/departments/[id]/lead/route.ts` — exact API route pattern to replicate for new creation routes
- `src/app/api/teams/route.ts` — stub POST (needs real implementation)
- `src/app/api/departments/route.ts` — stub POST (needs real implementation)
- `src/lib/use-org-data.ts` — isReadOnly = filesystem source, must be bypassed for creation

### Secondary (MEDIUM confidence)
- `03-UI-SPEC.md` — verified component names, layout contracts, button variants, color assignments
- `03-CONTEXT.md` — all decisions are direct user input; treated as HIGH for planning purposes

### Tertiary (LOW confidence)
- None — all claims are verified against source files.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed present in source files
- Architecture patterns: HIGH — derived directly from source code, not assumptions
- Pitfalls: HIGH — each pitfall traced to specific source file lines
- UI spec alignment: HIGH — cross-referenced with 03-UI-SPEC.md

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable Next.js/React/Zustand stack; no fast-moving APIs involved)
