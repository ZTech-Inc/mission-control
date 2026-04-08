---
phase: 04-agent-profile-enrichment
plan: "01"
subsystem: agent-profile-parser
tags: [parser, migration, database, types, tdd]
dependency_graph:
  requires: []
  provides:
    - "Migration 051_agent_profile_columns (6 new columns on agents table)"
    - "parseAgentProfile() function for enriched agent profile parsing"
    - "ParsedAgentProfile TypeScript interface"
    - "Updated Agent interface with new optional fields"
  affects:
    - "src/lib/migrations.ts (schema evolution)"
    - "src/store/index.ts (type system)"
    - "src/lib/org-scanner.ts (exported parse utilities)"
tech_stack:
  added: []
  patterns:
    - "TDD: RED (failing tests) -> GREEN (passing) cycle"
    - "Export parse utilities from org-scanner for reuse"
    - "Kebab normalization formula from agent-workspace.ts reused"
key_files:
  created:
    - src/lib/agent-profile-parser.ts
    - src/lib/__tests__/agent-profile-parser.test.ts
  modified:
    - src/lib/migrations.ts
    - src/lib/org-scanner.ts
    - src/store/index.ts
decisions:
  - "Export parseField, parseListField, parseMarkdownTableField, ParsedAgentMetadata from org-scanner so agent-profile-parser can reuse them without duplication"
  - "Add 'preferred runtime' (with space) as key alias alongside 'preferred_runtime' to match real AGENT.md content format"
  - "openclaw_id derived at parse time from resolved name using exact formula from agent-workspace.ts: rawName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')"
metrics:
  duration_minutes: 4
  completed_date: "2026-04-01"
  tasks_completed: 2
  files_changed: 5
---

# Phase 4 Plan 1: Agent Profile Parser and Schema Foundation Summary

Parser module and DB migration that add enriched metadata fields to the agent profile system — protocol_stack, deliverables, dependencies, preferred_runtime, and openclaw_id derived at parse time.

## What Was Built

**Migration 051:** Adds 6 new columns to the agents table — `openclaw_id` (TEXT, indexed), `protocol_stack` (TEXT, JSON array), `kpis` (TEXT, JSON array), `deliverables` (TEXT, JSON array), `dependencies` (TEXT, JSON array), `preferred_runtime` (TEXT). Does not add `workspace_path` (already exists from migration 034).

**agent-profile-parser.ts:** New parser module that reads AGENT.md and IDENTITY.md markdown content and extracts the full enriched agent profile. Exports `parseAgentProfile()` and `ParsedAgentProfile` interface. Merges and deduplicates fields from both sources. Derives `openclaw_id` using the same formula as `agent-workspace.ts`.

**org-scanner.ts:** Exported `parseField`, `parseListField`, `parseMarkdownTableField`, and `ParsedAgentMetadata` so agent-profile-parser can import them without code duplication.

**Agent interface:** Updated in `src/store/index.ts` with all new optional fields: `openclaw_id`, `protocol_stack`, `kpis`, `deliverables`, `dependencies`, `preferred_runtime`, `workspace_path`, `content_hash`, `source`.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Agent profile parser module with TDD tests | f552fff |
| 2 | Migration 051 + Agent interface update | 3f36d52 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added 'preferred runtime' key alias with space**
- **Found during:** Task 1 — test failures when parsing `Preferred Runtime: claude-code`
- **Issue:** `parseField` regex matched keys literally; `preferred_runtime` (underscore) didn't match `Preferred Runtime:` (space) in markdown
- **Fix:** Added `'preferred runtime'` as third key alias in `parseField` call: `['preferred_runtime', 'preferred runtime', 'runtime']`
- **Files modified:** src/lib/agent-profile-parser.ts
- **Commit:** f552fff (part of initial green pass)

**2. [Rule 1 - Bug] Test fixture corrected for underscore preservation**
- **Found during:** Task 1 RED->GREEN — one test expected `agent-name-123` from `Agent_Name!123`
- **Issue:** Test assumed underscores would be replaced with hyphens, but the formula `[^a-z0-9._-]` preserves underscores (underscore is NOT in the excluded set)
- **Fix:** Updated test input to `Agent Name!123` (space) which correctly becomes `agent-name-123`
- **Files modified:** src/lib/__tests__/agent-profile-parser.test.ts

## Known Stubs

None — all fields are fully parsed from real markdown content. No hardcoded values, no placeholders.

## Self-Check: PASSED

- [x] `src/lib/agent-profile-parser.ts` exists
- [x] `src/lib/__tests__/agent-profile-parser.test.ts` exists (>50 lines)
- [x] `src/lib/migrations.ts` contains `051_agent_profile_columns`
- [x] `src/store/index.ts` contains `openclaw_id?: string`
- [x] `src/lib/org-scanner.ts` exports `parseField`, `parseListField`, `ParsedAgentMetadata`
- [x] All 21 unit tests pass
- [x] Typecheck passes
