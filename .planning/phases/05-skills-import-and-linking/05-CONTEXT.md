# Phase 5: Skills Import and Linking - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning
**Source:** Auto mode (`$gsd-discuss-phase 5 --auto`)

<domain>
## Phase Boundary

Import `SKILL.md` files from each filesystem agent's `skills/` subdirectory into the global skills catalog using isolated per-agent source keys, and render matching inline skill names in the agent Profile tab as clickable links to the imported catalog entries. This phase does not add skill editing, skill-based routing, or new runtime/delegation behavior.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<specifics>
## Specific Ideas

- Auto-selected focus areas: import ownership, import lifecycle, catalog matching, and profile-tab interaction
- Recommended default preserved from prior research: org-agent skills should be imported through a dedicated importer instead of extending the hardcoded global root scan in `skill-sync.ts`
- The operator experience should feel like the existing Skills panel: clicking a matched skill reveals the real `SKILL.md` content and metadata already managed by the catalog

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements and milestone decisions
- `.planning/REQUIREMENTS.md` — `SKIL-01` and `SKIL-02`, plus the explicit out-of-scope rule against a full SKILL.md editor in the dashboard
- `.planning/ROADMAP.md` §Phase 5 — phase goal, dependency on `workspace_path`, and success criteria for import persistence plus profile linking
- `.planning/STATE.md` §Decisions — locked source namespace rule (`org-agent:<name>`) and phase-order dependency on Phase 4 metadata
- `.planning/research/PITFALLS.md` §Pitfall 3 — why org-agent skill import must stay isolated from generic skill sync
- `.planning/research/SUMMARY.md` — recommended architecture for Phase 5 and the no-scope-creep boundary around skills routing

### Existing skills catalog and sync surfaces
- `src/lib/skill-sync.ts` — current hardcoded local-skill sync flow and delete-on-missing behavior that Phase 5 must not reuse for org-agent imports
- `src/app/api/skills/route.ts` — current skills catalog API shape, list/content endpoints, and source-root handling used by the existing Skills panel
- `src/components/panels/skills-panel.tsx` — existing skill detail interaction surface that Phase 5 should reuse for linked profile skills
- `src/lib/migrations.ts` §`033_skills` — source/name uniqueness and existing `skills` table assumptions

### Existing agent profile and scanner infrastructure
- `src/lib/org-scanner.ts` — org scan lifecycle, `workspace_path` population, and the natural integration point for a post-profile skills importer
- `src/lib/agent-profile-parser.ts` — Phase 4 skill-name parsing that feeds the Profile tab chips needing link resolution
- `src/components/panels/agent-detail-tabs.tsx` — current Profile tab chip rendering that Phase 5 extends with clickable skill links
- `src/app/api/agents/route.ts` and `src/app/api/agents/[id]/route.ts` — agent payload shape currently exposing parsed `skills`

### Project instructions
- `AGENTS.md` — repo-level constraints, pnpm-only workflow, and testing expectations for any eventual implementation plans

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `skills` table and `/api/skills` route already provide the catalog storage and read-only content surface Phase 5 can reuse
- `skill-sync.ts` already demonstrates content hashing, description extraction, and upsert/delete patterns for local skill sources
- `agent-detail-tabs.tsx` already renders skill chips in `ProfileTab`, making it the natural place to add link resolution without redesigning the panel
- `org-scanner.ts` already has agent-by-agent sync with `workspace_path`, so a post-scan importer can attach to that lifecycle without inventing a new discovery entry point

### Established Patterns
- Skill records are uniquely keyed by `(source, name)` and use source strings as a first-class grouping mechanism across UI and API surfaces
- The current skills system assumes filesystem-backed, read-only detail views for local skill content and updates DB metadata from disk hashes
- Agent profile metadata comes from the filesystem and overwrites DB state on rescan; Phase 5 should follow that same filesystem-first model for imported agent skills

### Integration Points
- `scanFilesystemOrg()` / `ensureFilesystemAgent()` in `src/lib/org-scanner.ts` provide the point where imported agents and their `workspace_path` values are known
- `syncSkillsFromDisk()` in `src/lib/skill-sync.ts` is the main compatibility risk because it only knows global roots and auto-deletes missing rows for those sources
- `ProfileTab` in `src/components/panels/agent-detail-tabs.tsx` needs a way to map `agent.skills[]` values to existing catalog entries and trigger the current skill-content UX
- `/api/skills?mode=content` already serves the canonical `SKILL.md` payload that linked profile skills should open

</code_context>

<deferred>
## Deferred Ideas

- Skill-based agent recommendations and routing filters belong to the future "Skills Routing" requirements, not Phase 5
- Editing imported `SKILL.md` content from the dashboard remains out of scope
- Cross-agent browsing of duplicate skill names beyond deterministic exact-match linking is deferred until there is a dedicated disambiguation UX

</deferred>

---

*Phase: 05-skills-import-and-linking*
*Context gathered: 2026-04-01*
