# Phase 2: Add Way to Promote Agents to Team Lead - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 02-add-way-to-promote-agents-to-team-lead
**Areas discussed:** Persistence & API shape, Scope boundary, Promotion UX, Lead constraints, Chat routing impact
**Mode:** --auto --batch (all decisions auto-selected)

---

## Persistence & API Shape

| Option | Description | Selected |
|--------|-------------|----------|
| New API routes for team assignments | PATCH /api/teams/:id/assignments + PUT /api/departments/:id/lead | ✓ |
| Extend existing agent routes | Add role management to /api/agents/:id | |
| Store-only with periodic sync | Keep Zustand-only, batch sync to DB | |

**User's choice:** [auto] New API routes for team assignments (recommended default)
**Notes:** Separate endpoints keep concerns clean. Team assignments and department leads are different data models.

---

## Scope Boundary (Team vs Department Leads)

| Option | Description | Selected |
|--------|-------------|----------|
| Both team leads and department leads | Full lead assignment for both entity types | ✓ |
| Team leads only | Defer department lead assignment | |
| Department leads only | Focus on manager_agent_id | |

**User's choice:** [auto] Both team leads and department leads (recommended default)
**Notes:** Both are needed to fully enable Phase 1 chat routing. Department chat shows empty state without manager_agent_id set.

---

## Promotion UX

| Option | Description | Selected |
|--------|-------------|----------|
| Enhance existing inline button with confirmation | Keep "promote" button, add brief confirmation | ✓ |
| Modal confirmation dialog | Full modal before role change | |
| Drag-to-lead-zone | Drag agent card to a "lead" drop zone | |

**User's choice:** [auto] Enhance existing inline button with confirmation (recommended default)
**Notes:** Minimal change to existing UX. Inline confirmation avoids modal fatigue.

---

## Lead Constraints

| Option | Description | Selected |
|--------|-------------|----------|
| Single lead per team, multi-team OK | One lead per team, agent can lead multiple teams | ✓ |
| Single lead per team, single team per agent | Strict one-to-one | |
| Multiple leads per team | Co-leads allowed | |

**User's choice:** [auto] Single lead per team, agent can lead multiple teams (recommended default)
**Notes:** Matches existing handleSetLead behavior. No reason to restrict multi-team leadership.

---

## Chat Routing Impact

| Option | Description | Selected |
|--------|-------------|----------|
| Conversations stay, new messages route to new lead | Preserve history, update routing | ✓ |
| Close old conversations, start fresh | Clean break on lead change | |
| Archive and notify | Archive old, notify participants, start new | |

**User's choice:** [auto] Conversations stay, new messages route to new lead (recommended default)
**Notes:** Conversation ID is entity-based (team:7), not agent-based. Routing update is automatic.

---

## Claude's Discretion

- API error handling patterns
- Exact confirmation UX variant (tooltip vs inline expand)
- Testing approach
- Whether to batch endpoints

## Deferred Ideas

- Bulk role assignment
- Lead rotation scheduling
- Lead assignment history/audit trail
- Change notifications
- Permission-based lead assignment
