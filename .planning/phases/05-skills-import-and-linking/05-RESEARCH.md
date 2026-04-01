# Phase 5: Skills Import and Linking - Research

**Researched:** 2026-04-01
**Domain:** Agent-scoped skill catalog ingestion and profile-to-catalog linking in Next.js + SQLite
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Import ownership and source identity
- **D-01:** Imported skills use the source namespace `org-agent:<agent-name-slug>` so they never collide with existing sources such as `user-agents`, `project-codex`, `openclaw`, or `workspace-*`.
- **D-02:** The source key is derived from the imported agent identity already normalized in Phase 4, not from department/team grouping, so downstream lookups stay stable even if org structure changes.
- **D-03:** Imported rows must remain queryable as normal catalog entries in the existing `skills` table rather than a separate agent-skills table.

### Import timing and lifecycle
- **D-04:** Agent skill import runs as part of the org scan lifecycle after agent profiles are synced, using `workspace_path` from Phase 4 to locate `skills/` directories.
- **D-05:** Phase 5 uses a dedicated org-agent importer path, not the generic `syncSkillsFromDisk()` routine, so global disk sync cannot delete or overwrite org-agent rows accidentally.
- **D-06:** Re-scanning an agent updates existing imported skills in place and removes only that agent's imported skills that no longer exist under its `skills/` directory.

### Catalog matching for profile links
- **D-07:** Profile-tab skill links resolve by exact normalized skill-name match against the imported catalog for that same agent first.
- **D-08:** If no same-agent match exists, the UI may fall back to a single exact global catalog match by normalized name; if multiple matches exist, do not guess.
- **D-09:** Ambiguous or missing matches remain plain non-clickable skill chips rather than opening the wrong skill entry.

### Profile-tab interaction
- **D-10:** Clicking a linked skill should open the existing read-only skill detail surface backed by the skills catalog, not a new custom modal or editor.
- **D-11:** Linked and unlinked skills should remain visually consistent with the Phase 4 chip-based Profile tab; only the interaction affordance changes.
- **D-12:** Linking is limited to the Profile tab skill list in this phase, not the global agent cards, task flows, or skill suggestion surfaces.

### the agent's Discretion
- Exact slugging implementation for `org-agent:<agent-name-slug>` as long as it matches existing agent identity normalization conventions
- Whether the imported skill description preview is derived from the first paragraph of `SKILL.md` or a more structured field if already available
- Exact visual styling for clickable chips versus plain chips
- Whether ambiguous matches expose a muted tooltip or stay silently non-clickable

### Deferred Ideas (OUT OF SCOPE)
- Skill-based agent recommendations and routing filters belong to the future "Skills Routing" requirements, not Phase 5
- Editing imported `SKILL.md` content from the dashboard remains out of scope
- Cross-agent browsing of duplicate skill names beyond deterministic exact-match linking is deferred until there is a dedicated disambiguation UX
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKIL-01 | Org scanner recursively imports SKILL.md files from agent `skills/` subdirectories into the skills catalog | Dedicated `org-agent` importer, scan-lifecycle hook in `org-scanner.ts`, per-agent delete scope, DB-backed content lookup, duplicate-safe source handling |
| SKIL-02 | Agent profile visually links inline skill names to matching SKILL.md catalog entries | Normalized same-agent-first match strategy, ambiguity guardrails, source-aware skill lookup payload, reuse of existing skills detail surface |
</phase_requirements>

## Summary

Phase 5 should be planned as a source-aware extension of the existing skills catalog, not as a small filesystem scan bolted onto `skill-sync.ts`. The current codebase already has the right storage primitive, `skills(source, name)`, and the right user-facing detail API, `GET /api/skills?mode=content`. The gap is that current scanner, API, and UI assumptions are still rooted in a fixed list of global skill directories. If you only import rows into SQLite, the data will exist but parts of the catalog will stay invisible, unopenable, or ambiguously deduped.

The correct architecture is: org scan persists agents first, a dedicated org-agent importer scans `workspace_path/skills`, upserts rows into the existing `skills` table under `org-agent:<slug>`, deletes only rows for that one agent source when files disappear, and exposes those rows through the catalog via DB-backed lookup rather than root-backed source resolution. Profile-tab links should then resolve by normalized skill name against that agent's imported source first, fall back only to a single exact global match, and stay inert when ambiguous.

**Primary recommendation:** Plan Phase 5 as one cohesive source-aware catalog integration covering importer, API content lookup, duplicate-safe catalog listing, and Profile-tab linking together.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.1.6` | App Router API + UI shell | Already the repo framework; phase work is additive route/component logic |
| `react` | `19.0.1` | Client UI for linked skill chips and drawer triggers | Existing UI runtime; no need for new state library or modal framework |
| `better-sqlite3` | `12.6.2` | Catalog upsert/delete transactions | Existing persistence path; fits importer batch writes well |
| `tailwindcss` | `3.4.17` | Chip/link styling within established UI | Existing styling system; preserves Phase 4 visual language |
| `zustand` | `5.0.11` | Shared dashboard state if skill detail trigger is lifted | Existing store; use only if cross-panel selection state is needed |

Verified publish dates:
- `next@16.1.6` — 2026-01-27; latest on 2026-04-01 is `16.2.2`
- `react@19.0.1` — 2025-12-03; latest on 2026-04-01 is `19.2.4`
- `better-sqlite3@12.6.2` — 2026-01-17; latest on 2026-04-01 is `12.8.0`
- `tailwindcss@3.4.17` — 2024-12-17; latest on 2026-04-01 is `4.2.2`
- `zustand@5.0.11` — 2026-02-01; latest on 2026-04-01 is `5.0.12`

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `2.1.5` | Unit/integration tests for importer and matching helpers | Add fast coverage for slugging, matching, and DB sync rules |
| `@playwright/test` | `1.51.0` | End-to-end verification of rescan + linked skill click flow | Use for one operator-facing regression path |

**Installation:**
```bash
# No new package required for Phase 5
pnpm install
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `skills` table | Separate `agent_skills` table | Violates D-03 and would duplicate catalog logic, detail APIs, and UI grouping |
| Dedicated org-agent importer | Reuse `syncSkillsFromDisk()` | Incorrect delete semantics and hardcoded source roots make this unsafe |
| Existing detail surface | New profile-only modal | Extra UI to maintain and violates D-10 |

## Architecture Patterns

### Recommended Project Structure
```text
src/
├── lib/
│   ├── agent-skills-importer.ts   # New org-agent import + cleanup logic
│   ├── org-scanner.ts             # Invoke importer after agent profile sync
│   └── skill-name.ts              # Optional shared normalization helpers
├── app/api/skills/
│   └── route.ts                   # DB-backed content lookup for org-agent sources
└── components/panels/
    ├── agent-detail-tabs.tsx      # Clickable profile skill chips
    └── skills-panel.tsx           # Source-aware grouping / read-only handling for imported rows
```

### Pattern 1: Scan-Lifecycle Importer
**What:** Import agent-local skills during org scan after `workspace_path` is known and the agent row has been persisted.
**When to use:** Every forced or scheduled filesystem org rescan.
**Example:**
```ts
// Source: src/lib/org-scanner.ts, src/lib/skill-sync.ts
for (const syncedAgent of scannedAgents) {
  syncOrgAgentSkills({
    agentId: syncedAgent.id,
    agentName: syncedAgent.name,
    workspacePath: syncedAgent.workspacePath,
  })
}
```

### Pattern 2: Source-Scoped Upsert and Delete
**What:** Use `(source, name)` as the only identity and delete missing files only inside the current agent's source namespace.
**When to use:** During re-import of one agent's `skills/` subtree.
**Example:**
```ts
// Source: src/lib/migrations.ts (033_skills), src/lib/skill-sync.ts
const source = `org-agent:${agentSlug}`

db.transaction(() => {
  for (const diskSkill of diskSkills) upsertBySourceAndName(source, diskSkill)
  deleteMissingSkillsForSource(source, diskSkillNames)
})()
```

### Pattern 3: Same-Agent-First Match Resolution
**What:** Resolve a profile chip against the imported catalog for that agent first, then allow exactly one global fallback.
**When to use:** Rendering `agent.skills[]` in `ProfileTab`.
**Example:**
```ts
// Source: phase context decisions D-07..D-09
const exactAgentMatch = bySourceAndNormalizedName.get(`${agentSource}:${normalizedSkill}`)
if (exactAgentMatch) return exactAgentMatch

const globalMatches = byNormalizedName.get(normalizedSkill) ?? []
return globalMatches.length === 1 ? globalMatches[0] : null
```

### Pattern 4: DB-Backed Content Retrieval
**What:** Resolve skill content from the stored `skills.path` for imported sources instead of reconstructing a root from `getSkillRoots()`.
**When to use:** `GET /api/skills?mode=content` and any future read-only viewer for imported skills.
**Example:**
```ts
// Source: src/app/api/skills/route.ts
const row = db.prepare(
  'SELECT source, name, path FROM skills WHERE source = ? AND name = ?'
).get(source, name)
```

### Anti-Patterns to Avoid
- **Reuse `syncSkillsFromDisk()` for org agents:** It only understands hardcoded global roots and delete-on-missing semantics for those roots.
- **Deduplicate catalog entries by bare skill name in source-aware flows:** Imported per-agent skills will collide and vanish from filtered views.
- **Guess on ambiguous matches:** Opening the wrong skill violates D-09 and makes the UI untrustworthy.
- **Treat imported org-agent rows as editable global skills:** Current `POST`/`PUT`/`DELETE /api/skills` flows are root-backed and will not safely support `org-agent:*`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent skill persistence | New `agent_skills` schema | Existing `skills` table with `source='org-agent:<slug>'` | Already indexed, unique by source+name, and integrated into the catalog |
| Markdown preview extraction | Custom parser stack | Existing first-paragraph extraction pattern from `skill-sync.ts` and `/api/skills` | Good enough for description preview and already consistent |
| Skill detail viewer | New modal/editor flow | Existing skills detail surface/data contract | Keeps one canonical place for `SKILL.md` content |
| File delete reconciliation | Full cross-source resync | Per-source delete inside dedicated importer transaction | Prevents unrelated source deletion and honors D-06 |

**Key insight:** The hard part here is source identity and catalog semantics, not markdown parsing. Reuse existing catalog/storage patterns and only add the missing source-awareness.

## Common Pitfalls

### Pitfall 1: Imported Rows Exist but Cannot Be Opened
**What goes wrong:** `GET /api/skills?mode=content` currently resolves sources only from `getSkillRoots()`, so `org-agent:*` rows have no readable root.
**Why it happens:** The content route assumes every source corresponds to a predefined filesystem root.
**How to avoid:** Look up the row in SQLite first and read `skills.path/SKILL.md` from the stored path for imported sources.
**Warning signs:** Skill chip opens a 400/404 for a row visible in `/api/skills` or in SQLite.

### Pitfall 2: Duplicate Skill Names Vanish from the Catalog UI
**What goes wrong:** `/api/skills` dedupes the top-level `skills` list by bare `name`, and `skills-panel.tsx` filters against that deduped list.
**Why it happens:** The current panel was designed for mostly-global roots where duplicate names are rare.
**How to avoid:** Preserve per-source rows for source-filtered views and link resolution; if a deduped summary remains, keep a separate source-aware dataset for actual operations.
**Warning signs:** Group counts show imported skills but clicking the source filter does not list all of them.

### Pitfall 3: Org-Agent Groups Never Appear
**What goes wrong:** The DB fast path only creates dynamic groups for `workspace-*`, and the panel only whitelists a few known sources.
**Why it happens:** Unknown sources are treated as implementation details, not UI-visible catalog groups.
**How to avoid:** Include arbitrary DB sources in the grouped response and add an `org-agent:*` label formatter in the panel.
**Warning signs:** Imported rows are in `skills` table but no matching source card appears in the Skills panel.

### Pitfall 4: Wrong Skill Opens from the Profile Tab
**What goes wrong:** Matching by name alone across all sources can pick the wrong catalog entry when different agents share skill names.
**Why it happens:** The current catalog APIs are not agent-contextual.
**How to avoid:** Use same-agent source match first; only fall back when there is exactly one global exact normalized match.
**Warning signs:** Clicking the same skill label on two different agents opens the same catalog entry unexpectedly.

### Pitfall 5: Global Skill Sync Deletes Org-Agent Rows
**What goes wrong:** A later run of `syncSkillsFromDisk()` or scheduler-driven skill sync removes imported rows if Phase 5 reuses its semantics.
**Why it happens:** `skill-sync.ts` is authoritative for a fixed set of global sources and deletes rows missing from those roots.
**How to avoid:** Keep org-agent imports on a separate code path and never include `org-agent:*` in the generic source list.
**Warning signs:** Imported rows appear after org scan, then disappear after scheduler skill sync.

## Code Examples

Verified patterns from current code:

### Source-Scoped Skill Upsert
```ts
// Source: src/lib/skill-sync.ts
const insertStmt = db.prepare(`
  INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const updateStmt = db.prepare(`
  UPDATE skills SET path = ?, description = ?, content_hash = ?, updated_at = ?
  WHERE source = ? AND name = ?
`)
```

### Existing Agent Profile Persistence Hook
```ts
// Source: src/lib/org-scanner.ts
const agentId = ensureFilesystemAgent({
  workspaceId,
  name: agentName,
  workspacePath: agentPath,
  skills: JSON.stringify(metadata.skills),
  // ...
})
```

### Existing Skill Content API Contract
```ts
// Source: src/app/api/skills/route.ts
return NextResponse.json({
  source,
  name,
  skillPath,
  skillDocPath,
  content,
  security,
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed global skill roots only | Mixed global roots plus dynamic DB-backed catalog | Existing v2.x codebase | Phase 5 should extend the catalog, not replace it |
| Global-source assumptions in UI | Source-aware grouping is required | Needed now for `org-agent:*` imports | Unknown sources must be first-class in API and UI |
| Name-only skill summaries | Same-agent-contextual matching | Needed now for SKIL-02 | Duplicate names become normal, not exceptional |

**Deprecated/outdated:**
- Reusing `syncSkillsFromDisk()` for new source types: outdated for this phase because its source scope and delete model are intentionally narrow.

## Open Questions

1. **Should imported org-agent rows be visible in the editable global Skills panel immediately, or only be readable from profile links in Phase 5?**
   - What we know: D-03 says they stay in the existing `skills` table and remain normal catalog entries.
   - What's unclear: Current panel exposes save/delete affordances that are root-backed and unsafe for `org-agent:*`.
   - Recommendation: Plan read visibility in the catalog now, but gate edit/delete for `org-agent:*` rows as non-editable in this phase.

2. **Where should the skill-detail open state live for profile links?**
   - What we know: D-10 requires reusing the existing detail surface, but `skills-panel.tsx` owns its drawer state locally.
   - What's unclear: Whether to lift that state into Zustand, a shared parent panel, or a small reusable viewer component.
   - Recommendation: Prefer extracting a reusable read-only skill viewer component over pushing transient drawer state into the global store.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@2.1.5`, `@playwright/test@1.51.0` |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `pnpm test -- src/lib/__tests__/agent-profile-parser.test.ts` |
| Full suite command | `pnpm test:all` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SKIL-01 | Org rescan imports agent-local `SKILL.md` files, updates existing ones, and deletes only missing rows for that agent source | integration | `pnpm test -- src/lib/__tests__/agent-skills-importer.test.ts` | ❌ Wave 0 |
| SKIL-01 | Imported `org-agent:*` rows remain readable through `/api/skills` and `mode=content` | integration | `pnpm test -- src/lib/__tests__/skills-route-org-agent.test.ts` | ❌ Wave 0 |
| SKIL-02 | Profile skill chips link only when same-agent or unique global match exists; ambiguous names stay inert | component | `pnpm test -- src/components/panels/__tests__/agent-detail-tabs.test.tsx` | ❌ Wave 0 |
| SKIL-02 | Operator can run local org sync and click a linked profile skill to open content | e2e | `pnpm test:e2e --grep "skills import linking"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `pnpm test -- ...` command for touched importer/UI files
- **Per wave merge:** `pnpm test && pnpm typecheck`
- **Phase gate:** `pnpm test:all` before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/agent-skills-importer.test.ts` — covers SKIL-01 importer upsert/delete semantics
- [ ] `src/lib/__tests__/skills-route-org-agent.test.ts` — covers DB-backed content lookup and arbitrary-source grouping
- [ ] `src/components/panels/__tests__/agent-detail-tabs.test.tsx` — covers linked vs plain chip behavior
- [ ] `tests/skills-import-linking.spec.ts` — covers operator-facing local rescan and click-through flow

## Sources

### Primary (HIGH confidence)
- Local codebase: `src/lib/skill-sync.ts` — current source-scoped upsert/delete model
- Local codebase: `src/lib/org-scanner.ts` — org scan lifecycle and agent persistence hook
- Local codebase: `src/app/api/skills/route.ts` — catalog list/content contract and current source-root assumptions
- Local codebase: `src/components/panels/agent-detail-tabs.tsx` — current Profile-tab chip rendering
- Local codebase: `src/components/panels/skills-panel.tsx` — current skill detail surface and source-group rendering
- Local codebase: `src/lib/migrations.ts` (`033_skills`, `051_agent_profile_columns`, `052_agent_skills_column`) — current schema guarantees
- Local docs: `.planning/phases/05-skills-import-and-linking/05-CONTEXT.md`
- Local docs: `.planning/REQUIREMENTS.md`
- Local docs: `.planning/STATE.md`
- Local docs: `.planning/ROADMAP.md`
- Local docs: `.planning/research/PITFALLS.md`
- npm registry: https://www.npmjs.com/package/next
- npm registry: https://www.npmjs.com/package/react
- npm registry: https://www.npmjs.com/package/better-sqlite3
- npm registry: https://www.npmjs.com/package/tailwindcss
- npm registry: https://www.npmjs.com/package/zustand
- npm registry: https://www.npmjs.com/package/vitest
- npm registry: https://www.npmjs.com/package/@playwright/test

### Secondary (MEDIUM confidence)
- None needed; primary sources were sufficient

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against `package.json` and npm registry metadata on 2026-04-01
- Architecture: HIGH - based on direct inspection of the exact scanner, catalog API, and panel code paths this phase must modify
- Pitfalls: HIGH - derived from current source assumptions that already conflict with `org-agent:*` requirements

**Research date:** 2026-04-01
**Valid until:** 2026-05-01
