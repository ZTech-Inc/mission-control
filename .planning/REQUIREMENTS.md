# Requirements: ZTech Mission Control

**Defined:** 2026-04-01
**Core Value:** See which agent is working on what, delegate tasks to the right agent, and manage the entire agent task force from one screen.

## v1.1 Requirements

Requirements for milestone v1.1 Agent Gateway Integration. Each maps to roadmap phases.

### Agent Profiles

- [x] **PROF-01**: User can view structured agent profile showing name, role, skills, KPIs, org path, and protocol stack
- [x] **PROF-02**: Agent metadata fields (skills, KPIs, protocol stack, deliverables, dependencies) are stored as queryable DB columns, not buried in JSON blob
- [x] **PROF-03**: Org scanner parses deliverables, dependencies, reporting chain, and protocol stack from AGENT.md/IDENTITY.md

### Skills

- [ ] **SKIL-01**: Org scanner recursively imports SKILL.md files from agent `skills/` subdirectories into the skills catalog
- [ ] **SKIL-02**: Agent profile visually links inline skill names to matching SKILL.md catalog entries

### Runtime

- [ ] **RUNT-01**: User can spawn agent sessions on Claude Code and Codex runtimes (not just OpenClaw)
- [ ] **RUNT-02**: Agent cards display which runtime the agent uses and whether that runtime is currently live
- [ ] **RUNT-03**: User can choose which runtime to use when dispatching a specific task

### Delegation

- [ ] **DELG-01**: Tasks support parent-child hierarchy with parent_task_id and delegated_by tracking
- [ ] **DELG-02**: Team/department leads can break an incoming task into subtasks and assign to team members
- [ ] **DELG-03**: Parent task status auto-updates based on subtask completion progress

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Skills Routing

- **SKRT-01**: Task creation suggests best-fit agents based on skill overlap with task tags
- **SKRT-02**: Skills-gated routing filters agent list by required skill match

### Cross-Department

- **XDPT-01**: Tasks can be routed across department boundaries via department leads
- **XDPT-02**: Visual trace of delegation chain of custody across the hierarchy

### Monitoring

- **MNTR-01**: Auto-alert when a runtime goes from running to down during active task execution

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| LLM auto-decompose tasks at creation | Nondeterministic; the lead agent (in session) should do decomposition, not the dashboard |
| Write back to ZTech_Agents directory | Source-of-truth is filesystem/Git; dashboard is read-only |
| Full SKILL.md editor in dashboard | Skills need version control and review; show read-only, edit on disk |
| Multi-user collaboration | Single operator constraint (PROJECT.md); SSE live feed covers real-time updates |
| Task auto-assignment by dashboard | Dashboard lacks context for good assignment; provide suggestions, not automation |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROF-01 | Phase 4 | Complete |
| PROF-02 | Phase 4 | Complete |
| PROF-03 | Phase 4 | Complete |
| SKIL-01 | Phase 5 | Pending |
| SKIL-02 | Phase 5 | Pending |
| RUNT-01 | Phase 6 | Pending |
| RUNT-02 | Phase 6 | Pending |
| RUNT-03 | Phase 6 | Pending |
| DELG-01 | Phase 7 | Pending |
| DELG-02 | Phase 7 | Pending |
| DELG-03 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-01 after roadmap creation*
