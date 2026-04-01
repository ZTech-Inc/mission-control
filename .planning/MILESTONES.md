# Milestones

## v1.0 Agent Chat Spaces (Shipped: 2026-04-01)

**Phases completed:** 3 phases, 15 plans, 25 tasks

**Key accomplishments:**

- Finalized the shared status badge primitive and aligned `ChatInput` with the embedded-chat placeholder contract.
- Reusable embedded chat widget with local state, optimistic sends, smart polling, and status-aware system messaging for non-idle lead agents.
- Integrated embedded chat directly into department and team detail views as first-class tabs with lead-aware routing and empty states.
- Vitest todo scaffolds for team lead assignment, department lead persistence, and org-scanner source-priority coverage
- SQLite-backed team lead promotion routes, department lead persistence, and scanner protections that preserve manual lead assignments across rescans
- Persisted lead-promotion store actions, inline confirmation in team rosters, and department lead selection wired to refreshed org snapshots
- Added five vitest scaffold files that define all planned Phase 3 behaviors before implementation.
- Department manager terminology was unified across store/UI while filesystem org scanning now reads `MANAGER/` folders and exposes creation capability via `canCreate`.
- Creation API routes now write teams/departments/agents into both filesystem and SQLite with stable path-derived IDs and org snapshot invalidation.
- Filesystem-backed docs read/write now powers both team and department Docs tabs, with OrgDocsPanel fetching live API data and creating markdown files via POST.
- Teams Overview now provides an inline, two-column operator workflow with clickable roster selection and full 11-tab agent details inside the panel.
- Teams and departments now use prominent inline creation flows, including full D-09 team-agent creation and department manager hiring wired to the new API endpoints.
- Teams Chat now supports per-agent chat targeting with a chip selector, preserved selection across tab switches, and an agent-scoped conversation history sidebar.
- Add Member now opens a centered modal dialog with backdrop/Escape dismissal while preserving the existing agent creation form behavior.
- Human verification passed after a department-only docs layout fix restored full-height rendering for the docs view.

---
