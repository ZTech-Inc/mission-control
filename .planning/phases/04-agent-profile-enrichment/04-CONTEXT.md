# Phase 4: Agent Profile Enrichment - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Parse agent definition files (AGENT.md, IDENTITY.md, SOUL.md, USER.md) into structured DB columns and render rich profiles in the agent detail panel. Stores skills, KPIs, deliverables, dependencies, protocol stack, reporting chain as queryable schema columns. Derives openclawId at import time. Does not cover skills import from `skills/` subdirectories (Phase 5) or runtime dispatch (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Profile display
- **D-01:** New dedicated "Profile" tab in agent detail panel, alongside existing Overview tab
- **D-02:** Capabilities-first layout — skills and protocol stack at the top, identity/org path secondary
- **D-03:** Skills, KPIs, protocol stack, and deliverables rendered as tag/chip components
- **D-04:** Dependencies and reporting chain displayed below capabilities

### Parse failure handling
- **D-05:** Fields that fail to parse show an inline "could not parse" badge next to the field in the Profile tab
- **D-06:** Unparsed fields stored as null in DB columns; badge is driven by null + non-empty source file content

### Rescan merge behavior
- **D-07:** Filesystem always wins on rescan — all structured profile fields are overwritten from agent definition files
- **D-08:** Manual lead role assignments remain protected (existing `source='manual'` mechanism)
- **D-09:** Edit buttons available in the UI for profile fields as a convenience for quick changes, with the understanding that the next org rescan resets them from filesystem
- **D-10:** No warning banner on edit — the rescan-overwrites behavior is accepted

### Schema (pre-decided in STATE.md)
- **D-11:** New discrete columns: `protocol_stack`, `kpis`, `deliverables`, `dependencies`, `preferred_runtime`, `workspace_path` — not JSON blob
- **D-12:** `openclawId` derived and stored at import time
- **D-13:** Migrations must land before any parser or feature code

### Claude's Discretion
- Chip/tag visual styling and color coding
- Profile tab section spacing and typography
- "Could not parse" badge design
- Parser robustness strategies for varied markdown formats
- Column data types (TEXT with JSON arrays vs normalized tables)

</decisions>

<specifics>
## Specific Ideas

- Capabilities (skills, protocol stack) should be the first thing you see on the Profile tab — names and basic info are already on Overview
- Chips/tags for list-type fields, not verbose description lists

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Agent profile requirements
- `.planning/REQUIREMENTS.md` — PROF-01 (profile view), PROF-02 (queryable columns), PROF-03 (parser fields)
- `.planning/ROADMAP.md` §Phase 4 — Success criteria, dependency chain, required columns

### Existing parser infrastructure
- `src/lib/org-scanner.ts` — Current filesystem scanner with `parseAgentMetadata()`, `parseField()`, `parseListField()`, `parseMarkdownTableField()` utilities
- `src/lib/agent-sync.ts` — `enrichAgentConfigFromWorkspace()`, existing IDENTITY.md/TOOLS.md parsers

### Database schema
- `src/lib/schema.sql` — Current agents table definition (columns to extend)
- `src/lib/migrations.ts` — Migration infrastructure for new columns

### UI components
- `src/components/panels/agent-detail-tabs.tsx` — Agent detail panel with tab structure (new Profile tab goes here)
- `src/components/panels/agent-squad-panel-phase3.tsx` — AgentCard component (runtime badge display)

### State decisions
- `.planning/STATE.md` §Decisions — Column-not-JSON-blob rule, phase ordering, openclawId derivation

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseField()`, `parseListField()`, `parseMarkdownTableField()` in org-scanner.ts — markdown extraction utilities ready to extend for new fields (deliverables, dependencies, protocol_stack)
- `buildAgentContentHash()` in org-scanner.ts — change detection for rescan diffing
- `enrichAgentConfigFromWorkspace()` in agent-sync.ts — file reading pattern for agent workspace files
- Tab structure in agent-detail-tabs.tsx — straightforward to add a new Profile tab alongside existing tabs

### Established Patterns
- Org scanner stores parsed fields in `config` JSON today — Phase 4 migrates these to discrete columns while keeping the same parse logic
- `source='manual'` protection in agent_team_assignments — same pattern NOT applied to profile fields (D-07: filesystem always wins)
- Agent detail panel uses tab-based layout with lazy-loaded content per tab

### Integration Points
- `ensureFilesystemAgent()` in org-scanner.ts — upsert function that writes to agents table; must be extended to populate new columns
- `/api/agents` GET route — must return new columns in response payload
- Agent Zustand store — must include new fields in agent type definition
- `workspace_path` written here is consumed by Phase 5 (skills importer) and Phase 6 (runtime dispatch)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-agent-profile-enrichment*
*Context gathered: 2026-04-01*
