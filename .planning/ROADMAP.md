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

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 1
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 2 to break down)
