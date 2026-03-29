# ZTech Mission Control

## What This Is

A dashboard for managing an AI agent workforce organized as a virtual company (ZTech). It visualizes the hierarchical structure of departments, teams, and specialized sub-agents — auto-discovered from a directory tree — and lets you delegate tasks, monitor progress, and orchestrate work across multiple agent runtimes (Claude Code, OpenClaw, Codex).

## Core Value

See which agent is working on what, delegate tasks to the right agent, and manage the entire agent task force from one screen.

## Requirements

### Validated

- ✓ Dashboard overview with system stats, agent counts, session info — existing
- ✓ Agent registry and squad panel with status tracking — existing
- ✓ Department and team panels with drag-and-drop organization — existing
- ✓ Embedded department/team chat tabs with lead-aware routing and queue-aware status messaging — Phase 01
- ✓ Task board with kanban-style management — existing
- ✓ Live feed with real-time event streaming (SSE) — existing
- ✓ Chat/session management panel — existing
- ✓ Memory browser and graph visualization — existing
- ✓ Cost tracking and token usage monitoring — existing
- ✓ Cron job management — existing
- ✓ Log viewer — existing
- ✓ Activity feed and audit trail — existing
- ✓ User management and authentication — existing
- ✓ Settings, webhooks, alert rules — existing
- ✓ REST API + MCP server + CLI for agent control — existing
- ✓ Skills catalog — existing
- ✓ Notifications panel — existing
- ✓ GitHub sync — existing
- ✓ i18n/localization support — existing
- ✓ Onboarding wizard — existing
- ✓ Plugin system for extensible panels — existing

### Active

- [ ] Auto-discover org structure from ZTech_Agents directory (departments → teams → agents from folder hierarchy)
- [ ] Parse agent definition files (AGENT.md, IDENTITY.md, SOUL.md, USER.md) to populate agent profiles
- [ ] Import agent skills from skills/ subdirectories
- [ ] Detect and display team leads vs sub-agents from agent metadata
- [ ] Department lead detection and display
- [ ] Multi-runtime agent execution (Claude Code, OpenClaw, Codex)
- [ ] Task delegation to running persistent agents
- [ ] Spin up new agent sessions with task prompts
- [ ] Team lead coordination — break down tasks and distribute to sub-agents
- [ ] Real-time status tracking across all active agents regardless of runtime
- [ ] Hierarchical task flow: user → department lead → team lead → sub-agents

### Out of Scope

- Building custom agent runtimes — use existing Claude Code, OpenClaw, Codex
- Training or fine-tuning agents — agents are pre-defined in the directory structure
- Mobile app — web dashboard only
- Multi-user collaboration — single operator managing the agent workforce

## Context

- **Forked from:** Mission Control (builderz-labs), an open-source AI agent orchestration dashboard
- **Existing codebase:** Mature Next.js 16 app with SQLite, Zustand, comprehensive panel system, REST API, MCP server, CLI
- **Agent definitions live at:** `/home/heisenb/Documents/Work/z/ZTech_Agents/` — 14 departments, ~70 teams, hundreds of agents
- **Directory convention:** `Department/TEAM/Agent_Name/` with `AGENT.md`, `IDENTITY.md`, `SOUL.md`, `USER.md`, `skills/`
- **Agent metadata includes:** name, role, department, team, core skills, deliverables, KPIs, protocol stack (A2A, ACP, MCP, ICP), dependencies, reporting chain
- **Existing panels already handle:** departments, teams, agent squads — but currently use mock data and manual creation rather than directory-based auto-discovery
- **Supported runtimes:** Claude Code (local CLI sessions), OpenClaw (already has update/doctor banners in the UI), Codex (OpenAI's agent)

## Constraints

- **Tech stack**: Must stay on Next.js 16 / React 19 / TypeScript / SQLite / Tailwind / Zustand — the existing stack
- **No icon libraries**: Raw text/emoji only (existing convention)
- **Package manager**: pnpm only
- **Agent directory**: Read-only — dashboard reads from ZTech_Agents, never writes to it
- **Standalone output**: Must maintain `output: 'standalone'` for deployment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork Mission Control rather than build from scratch | Massive existing feature set (dashboard, agents, tasks, chat, API) already covers 80% of needs | — Pending |
| Directory-based org discovery | Agent hierarchy is already defined as folder structure in ZTech_Agents; avoids duplicating structure in DB | — Pending |
| Multi-runtime support (Claude Code + OpenClaw + Codex) | Different agents may run best on different runtimes; flexibility for the operator | — Pending |
| Team leads as coordinators, not just labels | Leads actively break down and distribute tasks — this is the core orchestration value | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-30 after Phase 01 completion*
