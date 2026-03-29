# Roadmap — ZTech Mission Control

## Milestone 1: Agent Chat Spaces

**Goal:** Enable operators to chat with department heads, team leads, and individual agents through distinct chat contexts within the existing ChatWorkspace.

### Phase 1: Agent Chat Spaces UI

**Goal:** Implement space selector, conversation lists, context headers, and status badges for department/team/agent chat spaces.

**Scope:**
- ChatSpaceSelector segmented control (departments/teams/agents)
- SpaceConversationList with entity-specific rendering per space
- ChatContextHeader with entity context and status display
- AgentStatusBadge unified status component
- Zustand state additions (activeChatSpace, lastConversationBySpace)
- Chat space utility functions for entity derivation
- Busy/offline/error agent messaging with queue hints
- Conversation ID format extension (dept:<id>, team:<id>)
- Empty states for all spaces
- Keyboard navigation and ARIA accessibility

**Requirements:** REQ-CHAT-SPACES
**Delivers:** UI components, state management, chat space utilities
**Status:** Complete (2026-03-30)
**Verification:** Passed via `01-VERIFICATION.md`

### Phase 2: Add way to promote agents to team lead

**Goal:** Add API-backed persistence for promoting/demoting agents to team lead roles and assigning department leads, with inline confirmation UX and visual feedback.
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15, D-16, D-17, D-18, D-19, D-20
**Depends on:** Phase 1
**Plans:** 3 plans

Plans:
- [x] 02-00-PLAN.md — Wave 0: test stubs for API routes and org-scanner source priority
- [ ] 02-01-PLAN.md — Data foundation: migration, scanner fix, snapshot propagation, API routes
- [ ] 02-02-PLAN.md — Store actions and panel UX: promote confirmation, lead badge, department lead selector
