# Phase 4: Agent Profile Enrichment - Research

**Researched:** 2026-04-01
**Domain:** SQLite schema migrations, markdown field parsing, Next.js React UI tabs
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Profile display**
- D-01: New dedicated "Profile" tab in agent detail panel, alongside existing Overview tab
- D-02: Capabilities-first layout — skills and protocol stack at the top, identity/org path secondary
- D-03: Skills, KPIs, protocol stack, and deliverables rendered as tag/chip components
- D-04: Dependencies and reporting chain displayed below capabilities

**Parse failure handling**
- D-05: Fields that fail to parse show an inline "could not parse" badge next to the field in the Profile tab
- D-06: Unparsed fields stored as null in DB columns; badge is driven by null + non-empty source file content

**Rescan merge behavior**
- D-07: Filesystem always wins on rescan — all structured profile fields are overwritten from agent definition files
- D-08: Manual lead role assignments remain protected (existing `source='manual'` mechanism)
- D-09: Edit buttons available in the UI for profile fields as a convenience for quick changes, with the understanding that the next org rescan resets them from filesystem
- D-10: No warning banner on edit — the rescan-overwrites behavior is accepted

**Schema (pre-decided in STATE.md)**
- D-11: New discrete columns: `protocol_stack`, `kpis`, `deliverables`, `dependencies`, `preferred_runtime`, `workspace_path` — not JSON blob
- D-12: `openclawId` derived and stored at import time
- D-13: Migrations must land before any parser or feature code

### Claude's Discretion
- Chip/tag visual styling and color coding
- Profile tab section spacing and typography
- "Could not parse" badge design
- Parser robustness strategies for varied markdown formats
- Column data types (TEXT with JSON arrays vs normalized tables)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROF-01 | User can view structured agent profile showing name, role, skills, KPIs, org path, and protocol stack | Profile tab in agent-detail-tabs.tsx; new ProfileTab component using new DB columns |
| PROF-02 | Agent metadata fields (skills, KPIs, protocol stack, deliverables, dependencies) are stored as queryable DB columns, not buried in JSON blob | Migration 051 adds six TEXT columns to agents table; `ensureFilesystemAgent()` extended to write them |
| PROF-03 | Org scanner parses deliverables, dependencies, reporting chain, and protocol stack from AGENT.md/IDENTITY.md | Extend `parseAgentMetadata()` using existing `parseListField()` and `parseField()` utilities |
</phase_requirements>

---

## Summary

Phase 4 is a surgical extension of three existing systems: the SQLite migration chain, the org-scanner parser, and the agent detail tab UI. All three are already fully operational — this phase adds columns to an existing table, extends an existing markdown parser with new field keys, and inserts one new tab into an existing tab list.

The migration infrastructure (`src/lib/migrations.ts`) uses an append-only numbered list. The last migration is `050_departments_manager_agent_id`. Phase 4 adds `051_agent_profile_columns` which adds six TEXT columns to the `agents` table via `ALTER TABLE ... ADD COLUMN` (safe for existing SQLite rows — null by default). The `workspace_path` column already exists (added in migration `034_agents_source`), so the new migration must check for it before adding.

The markdown parsing infrastructure in `src/lib/org-scanner.ts` already handles `skills` and `kpis` via `parseListField()`, but stores them in the JSON `config` blob rather than discrete columns. Phase 4 moves these to columns and adds `protocol_stack`, `deliverables`, `dependencies`, and `preferred_runtime` as new parse targets. The `openclawId` derivation pattern already exists in `src/lib/agent-workspace.ts` and `src/app/api/agents/[id]/route.ts` — it normalizes the agent name to kebab-case; Phase 4 stores that derived value in a new `openclaw_id` column at scan time.

The UI is a straightforward tab insertion. `teams-panel.tsx` already shows the full pattern: `DETAIL_TABS` constant array, `DetailTabContent` switch, `InlineAgentDetailsCard` render. The new `ProfileTab` component is added to `agent-detail-tabs.tsx` following the same export pattern as `OverviewTab`, `ConfigTab`, etc.

**Primary recommendation:** Write migration first (D-13). Then extend the parser in org-scanner.ts. Then add the Profile tab component. Then wire the tab into teams-panel.tsx and any other panel consumers. Each step is independently testable.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | project dependency | SQLite migrations, ALTER TABLE | Already used; synchronous API; migration runner in migrations.ts |
| React 19 / Next.js 16 | project dependency | ProfileTab component | Project stack per CLAUDE.md |
| TypeScript 5 | project dependency | Type safety for new columns | Project standard |
| Zustand | project dependency | Agent store state | Already used for Agent type in store/index.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto (createHash) | built-in | Content hashing for rescan diffing | Already used in buildAgentContentHash() |
| node:fs (readFileSync) | built-in | Reading AGENT.md/IDENTITY.md/SOUL.md/USER.md | Already used in safeRead() |

**No new dependencies required.** All needed tools are already in the project.

---

## Architecture Patterns

### Recommended Project Structure

New files for this phase:
```
src/lib/agent-profile-parser.ts   # Extracted parser logic (new lib module per STATE.md)
src/lib/__tests__/agent-profile-parser.test.ts   # Unit tests
```

Modified files:
```
src/lib/migrations.ts              # Append migration 051
src/lib/org-scanner.ts             # Extend parseAgentMetadata() + ensureFilesystemAgent()
src/store/index.ts                 # Add new fields to Agent interface
src/app/api/agents/route.ts        # SELECT * already returns new columns; type update only
src/components/panels/agent-detail-tabs.tsx   # Add ProfileTab export
src/components/panels/teams-panel.tsx         # Add 'Profile' to DETAIL_TABS, wire ProfileTab
```

### Pattern 1: Migration — ALTER TABLE with existence check

**What:** Add six columns to the existing `agents` table using the established `PRAGMA table_info` + `ADD COLUMN` pattern.

**When to use:** Every time a new column is added to an existing table in this codebase.

**Example** (following migration `034_agents_source` exact style):
```typescript
// src/lib/migrations.ts — append after migration 050
{
  id: '051_agent_profile_columns',
  up(db: Database.Database) {
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>
    const addIfMissing = (col: string, type: string) => {
      if (!cols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE agents ADD COLUMN ${col} ${type}`)
      }
    }
    addIfMissing('openclaw_id', 'TEXT')
    addIfMissing('protocol_stack', 'TEXT')
    addIfMissing('kpis', 'TEXT')
    addIfMissing('deliverables', 'TEXT')
    addIfMissing('dependencies', 'TEXT')
    addIfMissing('preferred_runtime', 'TEXT')
    // workspace_path already added in migration 034 — do NOT re-add
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_openclaw_id ON agents(openclaw_id)`)
  }
}
```

**Key constraint:** `workspace_path` already exists from migration `034_agents_source`. The new migration must NOT attempt to add it again.

### Pattern 2: Parser — parseListField with new keys

**What:** `parseListField()` in `org-scanner.ts` handles the bullet-list-after-key-line pattern. `parseField()` handles single-value inline fields. Both are regex-based, case-insensitive.

**When to use:** Any new field that can appear as a bullet list under a heading key.

**Example** (extending `parseAgentMetadata()` with new fields):
```typescript
// In agent-profile-parser.ts (new file, extracted from org-scanner.ts)
export interface ParsedAgentProfile extends ParsedAgentMetadata {
  protocol_stack: string[]
  deliverables: string[]
  dependencies: string[]
  preferred_runtime: string | undefined
  openclaw_id: string
}

export function parseAgentProfile(
  agentDirName: string,
  agentMd: string,
  identityMd: string
): ParsedAgentProfile {
  // ... existing parseAgentMetadata logic ...

  const protocol_stack = [
    ...parseListField(agentMd, ['protocol_stack', 'protocols', 'protocol stack']),
    ...parseListField(identityMd, ['protocol_stack', 'protocols', 'protocol stack']),
  ]

  const deliverables = [
    ...parseListField(agentMd, ['deliverables', 'outputs']),
    ...parseListField(identityMd, ['deliverables', 'outputs']),
  ]

  const dependencies = [
    ...parseListField(agentMd, ['dependencies', 'depends_on', 'depends on']),
    ...parseListField(identityMd, ['dependencies', 'depends_on', 'depends on']),
  ]

  const preferred_runtime =
    parseField(agentMd, ['preferred_runtime', 'runtime']) ||
    parseField(identityMd, ['preferred_runtime', 'runtime'])

  // Derive openclawId: kebab-case normalize of name (matches agent-workspace.ts pattern)
  const rawName = name || agentDirName
  const openclaw_id = rawName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

  return {
    ...existingMetadata,
    protocol_stack: [...new Set(protocol_stack)],
    deliverables: [...new Set(deliverables)],
    dependencies: [...new Set(dependencies)],
    preferred_runtime,
    openclaw_id,
  }
}
```

### Pattern 3: Column serialization — JSON arrays in TEXT columns

**What:** List-type fields (skills, kpis, protocol_stack, deliverables, dependencies) are stored as JSON-serialized arrays in TEXT columns. Single-value fields (preferred_runtime, openclaw_id) are stored as plain TEXT.

**When to use:** All list fields. Rationale: avoids a normalized junction table for fields whose only query pattern is "give me all values for agent X". SQLite supports `json_each()` for cross-agent queries if needed.

**Example:**
```typescript
// Writing to DB in ensureFilesystemAgent():
protocol_stack: JSON.stringify(profile.protocol_stack),  // '["MCP","REST"]'
kpis: JSON.stringify(profile.kpis),
deliverables: JSON.stringify(profile.deliverables),
dependencies: JSON.stringify(profile.dependencies),
preferred_runtime: profile.preferred_runtime ?? null,
openclaw_id: profile.openclaw_id,

// Reading from DB in API route:
agent.protocol_stack ? JSON.parse(agent.protocol_stack) : []
```

### Pattern 4: Profile Tab component

**What:** A new React component exported from `agent-detail-tabs.tsx` following the exact pattern of existing tab components.

**When to use:** New tab in the agent detail panel.

**Tab registration** (in `teams-panel.tsx`):
```typescript
// Add 'Profile' to the DETAIL_TABS tuple — place it after 'Overview' per D-01
const DETAIL_TABS = [
  'Overview',
  'Profile',   // NEW — after Overview
  'Files',
  'Tools',
  // ...rest unchanged
] as const

// Add case in DetailTabContent switch:
case 'Profile':
  return <ProfileTab agent={agent} />
```

**ProfileTab signature:**
```typescript
export function ProfileTab({ agent }: { agent: Agent }) {
  // agent now has .protocol_stack, .kpis, .deliverables, .dependencies,
  // .preferred_runtime, .openclaw_id as parsed values from API response
}
```

### Pattern 5: openclawId derivation (existing, now stored at scan time)

**What:** The codebase already derives openclawId on-the-fly in `agent-workspace.ts` (line 45) and `agent-sync.ts` (line 210). Phase 4 stores this at scan time in the `openclaw_id` column so downstream dispatch reads the column instead of re-deriving.

**Existing derivation formula** (verified in `src/lib/agent-workspace.ts` line 45):
```typescript
const openclawId = openclawIdRaw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
```

This same formula must be used in the new scanner to ensure consistency with openclaw.json-sourced agents.

### Pattern 6: ensureFilesystemAgent extension

**What:** The existing upsert function in `org-scanner.ts` must be extended to write the six new columns on both INSERT and UPDATE paths.

**Critical constraint (D-07):** Unlike `agent_team_assignments` which has the `source='manual'` conditional UPDATE, profile columns have **no protection** — filesystem always wins. The UPDATE statement overwrites all profile columns unconditionally.

**Critical constraint (D-08):** The `source='manual'` protection for `agent_team_assignments.role` is untouched — it lives in a different table and different upsert statement. Do not confuse with profile column behavior.

### Anti-Patterns to Avoid
- **Adding workspace_path to migration 051:** It already exists from migration `034_agents_source`. Running `ADD COLUMN workspace_path` again will cause a SQLite error.
- **Storing list fields as comma-separated strings:** Breaks on values containing commas. Use JSON arrays.
- **Parsing from the `config` JSON blob at read time:** Phase 4 explicitly moves skills/kpis out of the `config` blob and into discrete columns. New code must NOT read them from `config` — it must read from the new columns.
- **Skipping the PRAGMA check in the migration:** SQLite throws if you `ALTER TABLE ADD COLUMN` for a column that already exists. The `PRAGMA table_info` pattern is mandatory.
- **Applying source='manual' protection to profile columns:** D-07 is explicit — filesystem always wins for profile fields. Only `agent_team_assignments.role` has manual protection.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown list parsing | Custom regex parser | Existing `parseListField()` in org-scanner.ts | Already handles inline lists, bullet lists, dedup, multi-source merging |
| Markdown key-value parsing | Custom line scanner | Existing `parseField()` in org-scanner.ts | Already handles case-insensitive key matching, whitespace variants |
| Markdown table field parsing | Custom table reader | Existing `parseMarkdownTableField()` in org-scanner.ts | Already handles pipes, alignment rows, bold wrappers |
| Schema migrations | Custom DB init script | Existing `runMigrations()` / Migration array in migrations.ts | Migration runner handles idempotency, ordering, and applied-set tracking |
| openclawId derivation | New normalization function | Same formula as `agent-workspace.ts` line 45 | Must match existing derivation to avoid ID divergence |
| Tag/chip UI components | Custom styled spans | Simple `<span>` with Tailwind utility classes | Project uses no icon libraries and no component libraries beyond built-ins; check if a `Badge` or chip component already exists in `src/components/ui/` first |

**Key insight:** The parse infrastructure is already production-grade. The migration infrastructure is append-only by design. The tab UI is plug-and-play. Almost all Phase 4 work is wiring rather than building new systems.

---

## Common Pitfalls

### Pitfall 1: Double-adding workspace_path
**What goes wrong:** Migration 051 attempts `ALTER TABLE agents ADD COLUMN workspace_path TEXT`, causing `table agents already has a column named workspace_path` SQLite error. The DB fails to open.
**Why it happens:** Migration 034 already added `workspace_path`. It is not in `schema.sql` (only in migrations), so it won't be obvious from the schema file alone.
**How to avoid:** Always run `PRAGMA table_info(agents)` before adding — the existing migration pattern does this. Only add the six NEW columns: `openclaw_id`, `protocol_stack`, `kpis`, `deliverables`, `dependencies`, `preferred_runtime`.
**Warning signs:** Any migration that adds a column without a PRAGMA existence check.

### Pitfall 2: skills/kpis double-reading (config blob vs. new columns)
**What goes wrong:** API consumers read skills/kpis from `config.skills` (the old blob path) while the scanner now writes them to discrete columns. Two sources of truth diverge on rescan.
**Why it happens:** `ensureFilesystemAgent()` currently stores `skills` and `kpis` in `config` (line 525-526 of org-scanner.ts). Phase 4 moves them to columns. If the config write is not removed, old consumers see stale blob data.
**How to avoid:** Remove `skills` and `kpis` from the `config` object in `ensureFilesystemAgent()` when adding them as discrete columns. Update any API response consumers that read `config.skills` or `config.kpis`.
**Warning signs:** Agent API responses showing `config.skills` and a `kpis` column with different values.

### Pitfall 3: Agent type not updated in store
**What goes wrong:** `ProfileTab` accesses `agent.protocol_stack` but the TypeScript `Agent` interface in `src/store/index.ts` does not have these fields. Compile error or runtime `undefined`.
**Why it happens:** The `Agent` interface (line 171 in store/index.ts) only has core fields. New DB columns returned by the API are not automatically reflected in TypeScript types.
**How to avoid:** Update the `Agent` interface in `src/store/index.ts` to include the six new optional fields before building the ProfileTab component.
**Warning signs:** `tsc --noEmit` (pnpm typecheck) errors on `agent.protocol_stack`.

### Pitfall 4: JSON.parse on null columns
**What goes wrong:** `JSON.parse(agent.kpis)` throws when `kpis` is null (existing agents not yet rescanned).
**Why it happens:** New columns default to NULL for existing rows. The rescan hasn't run yet.
**How to avoid:** Always guard: `agent.kpis ? JSON.parse(agent.kpis) : []`. This is also the "could not parse" signal for the badge (D-05/D-06): null column + non-empty source file = show badge.
**Warning signs:** "Unexpected token n in JSON at position 0" runtime errors in the Profile tab.

### Pitfall 5: openclawId derivation divergence
**What goes wrong:** Filesystem-sourced agents get a different `openclaw_id` than openclaw.json-sourced agents that have an explicit `openclawId` field. Downstream dispatch uses the wrong handle.
**Why it happens:** The existing derivation in `agent-workspace.ts` checks `config.openclawId` first and only falls back to name normalization. For filesystem agents, `config.openclawId` is not set — only the directory name is available.
**How to avoid:** For filesystem agents, derive `openclaw_id` from the directory basename using the same normalization formula. Document that this value is a "best-effort" ID — it will match openclaw.json `id` fields only if naming conventions are consistent.
**Warning signs:** `openclaw_id` column values that don't appear in `openclaw.json agents.list[].id`.

### Pitfall 6: Tab not appearing in all panel consumers
**What goes wrong:** Profile tab is wired into `teams-panel.tsx` but not in other places the agent detail panel is rendered (e.g., the main agents page modal).
**Why it happens:** The tab list (`DETAIL_TABS`) and `DetailTabContent` switch are defined in `teams-panel.tsx`, not in a single shared location.
**How to avoid:** Search for all usages of `DETAIL_TABS` or `OverviewTab`/`ConfigTab` imports to find all panel consumers before declaring done. Run a codebase grep for `agent-detail-tabs` imports.
**Warning signs:** Profile tab visible in team view but missing in agent list modal.

---

## Code Examples

### Verified: existing parseListField signature
```typescript
// Source: src/lib/org-scanner.ts lines 187-221
function parseListField(content: string, keys: string[]): string[]
// Handles: "Skills: item1, item2" inline AND "Skills:\n- item1\n- item2" bullet list
// Returns: deduplicated string array
```

### Verified: existing migration pattern (034_agents_source)
```typescript
// Source: src/lib/migrations.ts lines 1032-1045
{
  id: '034_agents_source',
  up(db: Database.Database) {
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>
    if (!cols.some(c => c.name === 'source')) {
      db.exec(`ALTER TABLE agents ADD COLUMN source TEXT DEFAULT 'manual'`)
    }
    if (!cols.some(c => c.name === 'content_hash')) {
      db.exec(`ALTER TABLE agents ADD COLUMN content_hash TEXT`)
    }
    if (!cols.some(c => c.name === 'workspace_path')) {
      db.exec(`ALTER TABLE agents ADD COLUMN workspace_path TEXT`)
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_source ON agents(source)`)
  }
}
```

### Verified: existing ensureFilesystemAgent config write (to be modified)
```typescript
// Source: src/lib/org-scanner.ts lines 522-527
// Currently stores skills/kpis in config blob — Phase 4 moves these to columns
config: {
  orgSource: 'filesystem',
  folderOrg,
  skills: metadata.skills,   // REMOVE — move to discrete column
  kpis: metadata.kpis,       // REMOVE — move to discrete column
},
```

### Verified: openclawId normalization formula
```typescript
// Source: src/lib/agent-workspace.ts line 45
const openclawId = openclawIdRaw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
// For filesystem agents lacking explicit openclawId, apply same formula to directory name
```

### Verified: DETAIL_TABS pattern (where to add 'Profile')
```typescript
// Source: src/components/panels/teams-panel.tsx lines 34-46
const DETAIL_TABS = [
  'Overview',
  // INSERT 'Profile' HERE per D-01
  'Files',
  'Tools',
  'Models',
  'Channels',
  'Cron',
  'SOUL',
  'Memory',
  'Tasks',
  'Activity',
  'Config',
] as const
```

### Verified: existing Agent interface (to extend)
```typescript
// Source: src/store/index.ts lines 171-194
export interface Agent {
  id: number
  name: string
  role: string
  session_key?: string
  soul_content?: string
  working_memory?: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_seen?: number
  last_activity?: string
  created_at: number
  updated_at: number
  hidden?: number
  config?: JsonValue
  agentType?: 'openclaw' | 'claude-code' | 'codex' | 'generic'
  // Phase 4 adds: openclaw_id?, protocol_stack?, kpis?, deliverables?, dependencies?, preferred_runtime?
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| skills/kpis in config JSON blob | skills/kpis as TEXT columns (JSON-serialized arrays) | Phase 4 | SQL-queryable; no JSON extraction needed for filtering |
| openclawId derived at dispatch time | openclaw_id stored at scan time | Phase 4 | Downstream Phase 6 dispatch reads column, not re-derives |
| profile fields not in UI | Profile tab in agent detail panel | Phase 4 | Operators see capabilities without inspecting raw JSON |

**Deprecated/outdated after this phase:**
- Reading `config.skills` or `config.kpis` from the API response — use the new discrete columns
- Deriving openclawId at dispatch time from `config.openclawId || agent.name` — use `agent.openclaw_id` column

---

## Open Questions

1. **SOUL.md / USER.md field extraction**
   - What we know: `SOUL.md` is already read during scan for `soul_content`. `USER.md` is read for content hash but its fields are not currently parsed.
   - What's unclear: Do USER.md files in real ZTech_Agents directories contain any of the target fields (protocol_stack, deliverables, etc.) or are those exclusively in AGENT.md/IDENTITY.md?
   - Recommendation: Extend the parser to also check `USER.md` for the new fields (low cost to add, avoids missing data). Follow the existing pattern: `parseListField(userMd, ['protocol_stack', ...])`.

2. **Reporting chain field**
   - What we know: PROF-03 mentions "reporting chain" as a parse target. It is not listed as a discrete column in D-11.
   - What's unclear: Should reporting chain be a separate column or derived from the org assignment structure (department/team hierarchy already in DB)?
   - Recommendation: Parse `reporting_chain` / `reports_to` fields from AGENT.md as a TEXT column or store in the existing org assignment tables. If it maps to a single manager name, a `reports_to TEXT` column is sufficient. Confirm with planner whether to add this as a seventh new column or skip as derived from org structure.

3. **"could not parse" badge trigger condition**
   - What we know: D-06 says badge fires when column is null AND source file content is non-empty. The source file content is not stored in the DB.
   - What's unclear: Does the API need to pass source file content length/hash alongside the column value, or does the UI re-fetch the file?
   - Recommendation: The simplest approach is to also store `has_agent_md BOOLEAN` (or a non-null content_hash already covers this). When the Profile tab loads, if `kpis IS NULL AND content_hash IS NOT NULL`, show the badge — content_hash being non-null means a file was scanned. No file re-fetch needed.

---

## Validation Architecture

nyquist_validation is enabled in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROF-03 | `parseAgentProfile()` extracts protocol_stack from AGENT.md bullet list | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts -t "parses protocol_stack"` | Wave 0 |
| PROF-03 | `parseAgentProfile()` extracts deliverables from IDENTITY.md | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts -t "parses deliverables"` | Wave 0 |
| PROF-03 | `parseAgentProfile()` extracts dependencies | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts -t "parses dependencies"` | Wave 0 |
| PROF-03 | `parseAgentProfile()` derives openclaw_id from directory name | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts -t "derives openclaw_id"` | Wave 0 |
| PROF-03 | `parseAgentProfile()` returns null/empty for missing fields | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts -t "returns empty arrays"` | Wave 0 |
| PROF-02 | Migration 051 adds six new columns without error on existing DB | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts -t "migration 051"` | Wave 0 |
| PROF-02 | Migration 051 is idempotent (columns not re-added if they exist) | unit | same file | Wave 0 |
| PROF-01 | ProfileTab renders chip list for skills/kpis (smoke) | manual-only | `pnpm dev` + visual check | N/A — UI component |

**Manual-only justification for PROF-01:** ProfileTab is a client-only React component requiring a running Next.js server and browser. The existing test suite uses jsdom (vitest) but agent detail panels require full data fetch from running SQLite. Smoke test via browser is appropriate.

### Sampling Rate
- **Per task commit:** `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts`
- **Per wave merge:** `pnpm test`
- **Phase gate:** `pnpm typecheck && pnpm test && pnpm lint` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/agent-profile-parser.test.ts` — unit tests for new parser covering all PROF-03 fields plus openclaw_id derivation and migration idempotency
- [ ] `src/lib/agent-profile-parser.ts` — new module (extracted parser logic); must be created before tests can import it

*(Existing test infrastructure: `vitest.config.ts`, `src/test/setup.ts`, and all existing test fixtures are already present and usable.)*

---

## Sources

### Primary (HIGH confidence)
- Direct code read: `src/lib/migrations.ts` (all 50 migrations) — verified last migration is `050`, established PRAGMA guard pattern
- Direct code read: `src/lib/org-scanner.ts` (full file) — verified `parseListField`, `parseField`, `parseMarkdownTableField`, `ensureFilesystemAgent`, `buildAgentContentHash` APIs
- Direct code read: `src/lib/schema.sql` — verified `agents` table base columns
- Direct code read: `src/store/index.ts` — verified `Agent` interface shape
- Direct code read: `src/components/panels/teams-panel.tsx` — verified `DETAIL_TABS` constant and `DetailTabContent` switch pattern
- Direct code read: `src/lib/agent-workspace.ts` lines 41-45 — verified openclawId normalization formula
- Direct code read: `.planning/phases/04-agent-profile-enrichment/04-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- Code grep across `src/` for `protocol_stack`, `kpis`, `deliverables`, `dependencies`, `preferred_runtime`, `openclawId` — confirmed none of the six new columns exist yet in agents table

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in project, no new packages
- Architecture: HIGH — all patterns verified by direct code reading, no speculation
- Pitfalls: HIGH — pitfalls derived from actual code observations (migration 034 already adds workspace_path; config blob currently stores skills/kpis)
- UI patterns: HIGH — tab registration pattern verified from teams-panel.tsx source

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable codebase; 30-day window)
