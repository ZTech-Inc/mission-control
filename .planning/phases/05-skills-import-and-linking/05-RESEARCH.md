# Phase 5: Skills Import and Linking - Research

**Researched:** 2026-04-08
**Domain:** SQLite skill persistence, org-scanner extension, React UI skill chip linking
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKIL-01 | Org scanner recursively imports SKILL.md files from agent `skills/` subdirectories into the skills catalog | Dedicated `org-agent` importer, scan-lifecycle hook in `org-scanner.ts`, per-agent delete scope, DB-backed content lookup, duplicate-safe source handling |
| SKIL-02 | Agent profile visually links inline skill names to matching SKILL.md catalog entries | Normalized same-agent-first match strategy, ambiguity guardrails, source-aware skill lookup payload, reuse of existing skills detail surface |
</phase_requirements>

## Summary

Phase 5 adds two tightly scoped features on top of work completed in Phase 4. The first (SKIL-01) is a server-side import: when `scanFilesystemOrg` processes each agent directory it should also scan `<agentPath>/skills/` for SKILL.md files and upsert them into the `skills` table with the source key `org-agent:<agentName>`. The second (SKIL-02) is a client-side UI enhancement: the `ProfileChip` component inside `ProfileTab` renders skill names as plain spans today; each chip whose name exactly matches a catalog entry in the Zustand `skillsList` should become a clickable element that opens the SKILL.md detail view.

The skills table (`033_skills` migration) already exists with `UNIQUE(source, name)` and a boolean-absent `registry_slug` column that `syncSkillsFromDisk()` uses to distinguish locally-installed from registry-installed entries. The critical design constraint is that `syncSkillsFromDisk()` queries only a hard-coded whitelist of `localSources` and deletes rows whose source is in that whitelist but whose path has disappeared from disk. `org-agent:*` sources must NOT be added to that whitelist, or the next routine sync will silently delete all imported agent skills.

**Primary recommendation:** Add `importAgentSkillsFromPath()` called inside `syncFilesystemAgentFromPath` in `org-scanner.ts`, writing rows with `source = 'org-agent:<agentName>'`; update `ProfileChip` to accept an `onClick` prop and pass a handler only when the skill name matches a catalog entry.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | existing (project dep) | Synchronous SQLite writes for skill upserts inside org scan transaction | Already in use; org-scanner uses synchronous DB calls; no new dep |
| React + Zustand | existing | Skill catalog state already in store; UI linking reads from `skillsList` | Zero new dependencies; linking is pure state lookup |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs (sync) | Node.js built-in | `readdirSync` / `readFileSync` for scanning `skills/` subdirs inside org scan | Already used in `skill-sync.ts` and `org-scanner.ts`; keep sync to avoid introducing async into the transaction |
| node:path | Node.js built-in | Path construction for `<agentPath>/skills/` | Consistent with existing code |
| node:crypto | Node.js built-in | SHA-256 hash for `content_hash` on upserted skill rows | Already in `skill-sync.ts` and `skill-registry.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `scanFilesystemOrg` | A separate cron that imports agent skills after scan | Cron adds timing gaps; in-scan import ensures agent rows and skill rows are consistent. In-scan is simpler and already the pattern for everything else. |
| Exact-match skill linking | Fuzzy/case-insensitive match | Fuzzy matching risks false positives in the profile UI; exact match is safer and matches how skill IDs are stored (`source:name`). Case-insensitive normalization (`.toLowerCase()`) is acceptable. |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure

No new directories needed. Additions are in-place extensions:

```
src/lib/
  org-scanner.ts          # +importAgentSkillsFromPath() called from syncFilesystemAgentFromPath()
  skill-sync.ts           # NO CHANGE — must not learn about org-agent:* sources
src/components/panels/
  agent-detail-tabs.tsx   # ProfileChip -> clickable variant when skill matches catalog
```

### Pattern 1: In-scan skill upsert with namespaced source key

**What:** Inside `syncFilesystemAgentFromPath` in `org-scanner.ts`, after writing the agent row, scan `<agentPath>/skills/` for subdirectories containing `SKILL.md` and upsert each into the `skills` table with `source = 'org-agent:<agentDirName>'`.

**When to use:** Always called as part of `scanFilesystemOrg` — no separate trigger needed.

**Example (pseudocode):**
```typescript
// Inside org-scanner.ts, within syncFilesystemAgentFromPath()
function importAgentSkillsFromPath(agentDirName: string, agentPath: string, db: Database): void {
  const skillsRoot = path.join(agentPath, 'skills')
  if (!existsSync(skillsRoot)) return

  const source = `org-agent:${agentDirName}`
  const now = new Date().toISOString()

  let entries: string[]
  try {
    entries = readdirSync(skillsRoot)
  } catch {
    return
  }

  const upsert = db.prepare(`
    INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, name) DO UPDATE SET
      path = excluded.path,
      description = excluded.description,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at
  `)

  for (const entry of entries) {
    const skillPath = path.join(skillsRoot, entry)
    try {
      if (!statSync(skillPath).isDirectory()) continue
    } catch { continue }
    const skillDoc = path.join(skillPath, 'SKILL.md')
    if (!existsSync(skillDoc)) continue
    try {
      const content = readFileSync(skillDoc, 'utf8')
      const hash = sha256(content)  // reuse helper from skill-sync pattern
      const desc = extractDescription(content)  // reuse helper
      upsert.run(entry, source, skillPath, desc ?? null, hash, now, now)
    } catch { /* unreadable — skip */ }
  }
}
```

Note: `importAgentSkillsFromPath` must be called INSIDE the `db.transaction()` in `syncFilesystemAgentFromPath` (or called on the same db instance after the agent row write but before the transaction commits). The transaction wrapping in `syncTxn` already covers all agent writes — skill upserts can be added to the same transaction to ensure atomicity.

### Pattern 2: Skill name matching for UI linking

**What:** In `ProfileTab`, pass the Zustand `skillsList` to `ProfileField` for the skills row. `ProfileField` iterates chips and wraps ones whose `name` matches a catalog entry in a button with an `onClick` handler.

**When to use:** Only for the Skills field in `ProfileTab`, not for Protocol Stack or other fields.

**Example:**
```typescript
// In agent-detail-tabs.tsx

// Add catalog-aware chip variant:
function SkillChip({ label, catalogEntry, onOpen }: {
  label: string
  catalogEntry?: { source: string; name: string } | null
  onOpen?: (source: string, name: string) => void
}) {
  if (catalogEntry && onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(catalogEntry.source, catalogEntry.name)}
        className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary underline-offset-2 hover:bg-primary/20 hover:underline transition-colors"
      >
        {label}
      </button>
    )
  }
  return <ProfileChip label={label} />
}
```

The `onOpen` callback navigates to the skills panel with the skill pre-selected, OR opens an inline drawer reusing `SkillsPanel`'s skill content fetch pattern (`/api/skills?mode=content&source=<s>&name=<n>`).

### Anti-Patterns to Avoid

- **Adding `org-agent:*` to `localSources` in `skill-sync.ts`:** This will cause `syncSkillsFromDisk()` to delete all org-agent skills on every routine sync because those paths are inside agent workspace directories, not the standard skill roots. The `localSources` whitelist must remain unchanged.
- **Running `importAgentSkillsFromPath` outside the transaction:** Skill rows written outside the wrapping `db.transaction()` can be left orphaned if the scan fails partway. Keep all writes inside the transaction.
- **Fetching skill catalog in `ProfileTab` independently:** `skillsList` is already in the Zustand store (populated by `SkillsPanel`). Read from the store; do not add a `fetch('/api/skills')` call inside the profile tab.
- **Case-sensitive exact matching only:** Skill names in `AGENT.md` (e.g., "Multi-agent systems") may differ in casing from SKILL.md directory names (e.g., `multi-agent-systems`). Use case-insensitive comparison and/or slug normalization for matching.
- **Writing skills into the existing `skill-sync.ts` `getSkillRoots()`:** Org-agent skill directories are not standard roots; injecting them there would couple the two subsystems incorrectly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 content hash | Custom hash function | `createHash('sha256').update(content).digest('hex')` from `node:crypto` | Already used in `skill-sync.ts` and `skill-registry.ts`; copy the helper |
| Description extraction | Custom parser | `extractDescription()` pattern from `skill-sync.ts` (first non-heading line, truncate at 220 chars) | Already established; duplication is acceptable here since the function is small |
| Skill content fetch for the link detail view | New API route | `/api/skills?mode=content&source=<s>&name=<n>` already exists in `src/app/api/skills/route.ts` | Complete implementation exists; reuse `SkillContentResponse` interface |
| Skill catalog lookup | New endpoint | Zustand `skillsList` already populated by `SkillsPanel` on mount | Avoid double-fetching; read from store |

**Key insight:** The entire infrastructure for skills — DB table, sync engine, API routes, UI panel — already exists. Phase 5 is additive plumbing (teach the org scanner to populate one new source key) plus a UI chip enhancement, not new subsystem work.

## Common Pitfalls

### Pitfall 1: `syncSkillsFromDisk()` deletes org-agent skill rows

**What goes wrong:** If `org-agent:*` is mistakenly added to `localSources` in `skill-sync.ts`, the next periodic sync (which runs on a cron) will query those rows, find no matching paths under standard skill roots, and delete them. Skills silently disappear from the catalog.

**Why it happens:** `syncSkillsFromDisk()` treats "not found on disk scan" as "deleted" for any source it manages. Org-agent skills live inside agent workspace paths (`<agentsDir>/<dept>/<team>/<agent>/skills/`), not in the standard roots.

**How to avoid:** Do NOT touch `localSources` in `skill-sync.ts`. The `org-agent:*` source is managed exclusively by the org scanner. Source isolation is the correct design.

**Warning signs:** Skills panel shows org-agent skills briefly after a scan then loses them. Check `skill-sync.ts` `localSources` array.

### Pitfall 2: Skill name vs. skill directory name mismatch in UI linking

**What goes wrong:** An agent's `AGENT.md` might list skills as `"Multi-agent systems"` but the SKILL.md directory is named `multi-agent-systems`. Exact-match linking finds no catalog entry and the chip stays non-clickable.

**Why it happens:** Skill names in AGENT.md are free-form text; SKILL.md directory names follow filesystem conventions (lowercase, hyphenated).

**How to avoid:** Normalize both sides for comparison: lowercase + replace spaces/underscores with hyphens. Store the original display label from AGENT.md in the chip, but match against the normalized form.

**Warning signs:** Skill chips never become clickable even though the same skill appears in the catalog.

### Pitfall 3: Running skill imports outside the scan transaction

**What goes wrong:** If `importAgentSkillsFromPath` is called after the `syncTxn()()` call in `scanFilesystemOrg`, a scan error partway through an agent list can leave skill rows written for agents whose records were never committed.

**Why it happens:** The skill upsert is a separate `db.prepare().run()` sequence added outside the transaction.

**How to avoid:** Call `importAgentSkillsFromPath` inside the `syncTxn` transaction, in the same loop iteration that processes each agent.

**Warning signs:** Skills table has entries for agent names that don't appear in the agents table.

### Pitfall 4: Profile tab skill chips causing a second `/api/skills` fetch

**What goes wrong:** If `ProfileTab` fetches the skill catalog independently, every time a user opens an agent detail panel it fires a new API call. On a large team this creates N concurrent requests.

**Why it happens:** Tempting to add a `useEffect` fetch inside `ProfileTab` without noticing `skillsList` is already available in the store.

**How to avoid:** Read from `useMissionControl().skillsList` in `ProfileTab`. If `skillsList` is null (catalog not yet loaded), render plain chips — no link, no fetch.

**Warning signs:** Network tab shows `/api/skills` calls each time an agent drawer opens.

### Pitfall 5: SKILL.md content serving for org-agent paths fails the source lookup

**What goes wrong:** `/api/skills?mode=content&source=org-agent:AgentName&name=<skill>` returns 400 "Invalid source" because `getSkillRoots()` in the skills route only returns the 5 standard roots and dynamic `workspace-*` roots.

**Why it happens:** `org-agent:*` sources are not in `getSkillRoots()` because they are not standard fixed roots.

**How to avoid:** Add a DB-backed fallback to the content-serving path: if `source` starts with `org-agent:`, look up `path` from the `skills` table where `source = ? AND name = ?`, then serve `path/SKILL.md` directly. The `path` column already stores the full directory path.

**Warning signs:** Clicking a skill chip produces a 400 or 404 response even though the skill is in the DB.

## Code Examples

Verified patterns from existing codebase:

### Upsert pattern (from `skill-sync.ts`)
```typescript
// Source: src/lib/skill-sync.ts lines 167-199
const insertStmt = db.prepare(`
  INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)
// ON CONFLICT variant (from skill-registry.ts):
db.prepare(`
  INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source, name) DO UPDATE SET
    path = excluded.path,
    description = excluded.description,
    content_hash = excluded.content_hash,
    updated_at = excluded.updated_at
`).run(name, source, skillPath, desc ?? null, hash, now, now)
```

### Description extraction pattern (from `skill-sync.ts`)
```typescript
// Source: src/lib/skill-sync.ts lines 56-57
function extractDescription(content: string): string | undefined {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const first = lines.find(l => !l.startsWith('#'))
  if (!first) return undefined
  return first.length > 220 ? `${first.slice(0, 217)}...` : first
}
```

### Existing ProfileChip component (from `agent-detail-tabs.tsx`)
```typescript
// Source: src/components/panels/agent-detail-tabs.tsx lines 49-55
function ProfileChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
      {label}
    </span>
  )
}
```

### Existing skills store shape (from `src/store/index.ts`)
```typescript
// Source: src/store/index.ts lines 621-624
skillsList: { id: string; name: string; source: string; path: string; description?: string; registry_slug?: string | null; security_status?: string | null }[] | null
skillGroups: ...
skillsTotal: number
setSkillsData: (skills, groups, total) => void
```

### Content fetch API (existing, from `src/app/api/skills/route.ts`)
```
GET /api/skills?mode=content&source=<source>&name=<name>
Response: { source, name, skillPath, skillDocPath, content, security }
```

### Skill table UNIQUE constraint (from migration `033_skills`)
```sql
-- Source: src/lib/migrations.ts line 1023
UNIQUE(source, name)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Skills only from 5 standard roots | Skills also from org-scanner agent subdirectories | Phase 5 (now) | Org-imported skills visible in catalog without manual install |
| Skill chips are plain text spans | Skill chips are clickable links when catalog entry exists | Phase 5 (now) | Profile tab becomes navigation point into the skills catalog |

**Deprecated/outdated:** None — no existing patterns are being replaced, only extended.

## Open Questions

1. **Where does the skill link UI navigate?**
   - What we know: Skills panel (`/skills`) has a full detail drawer already (`selectedSkill` state, fetch via `?mode=content`). Agent detail tab is a slide-in drawer over the dashboard.
   - What's unclear: Should clicking a skill chip (a) open an inline mini-drawer within the agent detail panel, (b) navigate to the Skills panel with the skill pre-selected, or (c) open a portal overlay?
   - Recommendation: Open a simple inline detail view within the agent detail panel using the same `?mode=content` fetch pattern. Avoids navigation away from the current agent context. Use a portal or nested state — similar to how `SkillsPanel` renders `selectedSkill`.

2. **Skill name normalization rules for matching**
   - What we know: Agent.md skills are free text; SKILL.md dirs are filesystem names.
   - What's unclear: Is there a canonical normalization? Should `"Multi-agent systems"` match `multi-agent-systems` or `Multi-agent-systems`?
   - Recommendation: Normalize as `s.toLowerCase().replace(/[\s_]+/g, '-')` on both sides for comparison. Display label always comes from the agent's own skills array (not the catalog name).

3. **How many SKILL.md files should we expect per agent?**
   - What we know: No production data in this repo; spec says "skills/ subdirectory" (plural).
   - What's unclear: Could be 0–50 per agent; scanning cost is O(n) per agent.
   - Recommendation: No special optimization needed; `readdirSync` is O(n) and adequate.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified — phase is code/config changes only within the existing Next.js + SQLite + React stack).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test:all` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SKIL-01 | Org scanner upserts skills with `org-agent:<name>` source into DB | unit | `pnpm test -- --reporter=verbose src/lib/__tests__/agent-skills-import.test.ts` | ❌ Wave 0 |
| SKIL-01 | `syncSkillsFromDisk()` does NOT delete `org-agent:*` rows | unit | same file | ❌ Wave 0 |
| SKIL-01 | Re-scan overwrites (not duplicates) existing `org-agent:*` rows | unit | same file | ❌ Wave 0 |
| SKIL-02 | `ProfileChip` renders as button when catalog entry matches | unit | `pnpm test -- --reporter=verbose src/lib/__tests__/profile-skill-linking.test.ts` | ❌ Wave 0 |
| SKIL-02 | Non-matching skill names remain as plain chips | unit | same file | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test:all`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/agent-skills-import.test.ts` — covers SKIL-01 (importer + sync-survival)
- [ ] `src/lib/__tests__/profile-skill-linking.test.ts` — covers SKIL-02 (chip linking behavior)

No framework install needed — Vitest is already configured and running.

## Project Constraints (from CLAUDE.md)

These directives are enforced regardless of what research recommends:

- **Package manager:** pnpm only — no npm/yarn
- **No icon libraries:** Use raw text/emoji in components
- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:` etc.) — no AI attribution trailers
- **Path alias:** `@/*` maps to `./src/*` — use this in all new imports
- **No UI write-back:** Dashboard is read-only relative to the filesystem — this phase only reads SKILL.md files, does not write them
- **No SKILL.md editor:** Skills are read-only in the dashboard; the profile chip opens a read-only detail view, not an editor
- **Standalone output:** Keep all code compatible with `output: 'standalone'` (no runtime-only deps)
- **better-sqlite3:** Native addon — synchronous API only in server-side code; no async SQLite calls

## Sources

### Primary (HIGH confidence)

- `src/lib/skill-sync.ts` — Full implementation of `syncSkillsFromDisk()`, `localSources` list, upsert/delete logic
- `src/lib/org-scanner.ts` — `scanFilesystemOrg`, `syncFilesystemAgentFromPath`, transaction structure
- `src/lib/migrations.ts` (migration `033_skills`, `052_agent_skills_column`) — Skills table schema and UNIQUE constraint
- `src/app/api/skills/route.ts` — Skills API including `?mode=content` endpoint and `getSkillRoots()`
- `src/components/panels/agent-detail-tabs.tsx` — `ProfileTab`, `ProfileChip`, `ProfileField` components
- `src/store/index.ts` — Zustand `skillsList` / `setSkillsData` shape
- `.planning/STATE.md` — Locked decision: `org-agent:<name>` source namespace

### Secondary (MEDIUM confidence)

- `src/lib/skill-registry.ts` — `installFromRegistry()` upsert pattern; confirms ON CONFLICT DO UPDATE is the project-standard approach
- `src/components/panels/skills-panel.tsx` — Existing skill detail fetch and drawer rendering pattern

### Tertiary (LOW confidence)

- None — all findings verified against source code directly.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against existing code; no new libraries
- Architecture: HIGH — org-scanner extension point identified precisely; skills table constraints confirmed
- Pitfalls: HIGH — `localSources` exclusion risk verified by reading `skill-sync.ts` lines 147-156; sync-deletion behavior confirmed
- UI pattern: HIGH — `ProfileChip` component and `skillsList` store shape verified directly

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable stack; no external dependencies that drift)
