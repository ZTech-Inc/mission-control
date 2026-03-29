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
