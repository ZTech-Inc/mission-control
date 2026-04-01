---
phase: 05
slug: skills-import-and-linking
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest, @playwright/test |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `pnpm test -- src/lib/__tests__/agent-skills-importer.test.ts` |
| **Full suite command** | `pnpm test:all` |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** Run the targeted `pnpm test -- ...` command for the touched importer, API, or profile-linking area
- **After every plan wave:** Run `pnpm test && pnpm typecheck`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SKIL-01 | test-scaffold | `cd /Users/rahmanwolied/Documents/Work/Ztech/mission-control && test -f src/lib/__tests__/agent-skills-importer.test.ts && test -f src/lib/__tests__/skills-route-org-agent.test.ts && rg -n "org-agent:atlas-coordinator|buildOrgAgentSkillSource|syncOrgAgentSkills" src/lib/__tests__/agent-skills-importer.test.ts && rg -n "mode=content|org-agent:atlas-coordinator|groups" src/lib/__tests__/skills-route-org-agent.test.ts` | ✅ direct | ✅ green |
| 05-01-02 | 01 | 1 | SKIL-01 | integration | `cd /Users/rahmanwolied/Documents/Work/Ztech/mission-control && pnpm test -- --run src/lib/__tests__/agent-skills-importer.test.ts src/lib/__tests__/skills-route-org-agent.test.ts` | ✅ in-task | ✅ green |
| 05-01-03 | 01 | 1 | SKIL-01 | component | `cd /Users/rahmanwolied/Documents/Work/Ztech/mission-control && pnpm test -- --run src/lib/__tests__/skills-route-org-agent.test.ts src/components/panels/__tests__/skills-panel-org-agent.test.tsx` | ✅ in-task | ✅ green |
| 05-02-01 | 02 | 2 | SKIL-02 | test-scaffold | `cd /Users/rahmanwolied/Documents/Work/Ztech/mission-control && test -f src/components/panels/__tests__/agent-detail-tabs.test.tsx && test -f tests/skills-import-linking.spec.ts && rg -n "Retrospective|PromptPlanning|Research|DeepWork" src/components/panels/__tests__/agent-detail-tabs.test.tsx && rg -n "skills import linking" tests/skills-import-linking.spec.ts` | ✅ direct | ⬜ pending |
| 05-02-02 | 02 | 2 | SKIL-02 | component+e2e | `cd /Users/rahmanwolied/Documents/Work/Ztech/mission-control && pnpm test -- --run src/components/panels/__tests__/agent-detail-tabs.test.tsx && pnpm test:e2e --grep "skills import linking"` | ✅ in-task | ⬜ pending |
| 05-02-03 | 02 | 2 | SKIL-02 | checkpoint-regression | `cd /Users/rahmanwolied/Documents/Work/Ztech/mission-control && pnpm test -- --run src/components/panels/__tests__/agent-detail-tabs.test.tsx && pnpm test:e2e --grep "skills import linking"` | ✅ inherited | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Automated Coverage Inventory

- [x] `src/lib/__tests__/agent-skills-importer.test.ts` — SKIL-01 importer upsert/delete semantics and per-source cleanup
- [x] `src/lib/__tests__/skills-route-org-agent.test.ts` — DB-backed content lookup and arbitrary-source grouping for `org-agent:*`
- [x] `src/components/panels/__tests__/skills-panel-org-agent.test.tsx` — read-only skills-panel behavior for `org-agent:*` rows
- [ ] `src/components/panels/__tests__/agent-detail-tabs.test.tsx` — profile-tab linked vs plain skill chip behavior
- [ ] `tests/skills-import-linking.spec.ts` — end-to-end operator flow for local org rescan and skill click-through

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Imported skill appears with the correct source label in the Skills panel and opens the expected `SKILL.md` detail for a real filesystem agent | SKIL-01, SKIL-02 | Requires a representative local ZTech_Agents workspace and real scan data beyond isolated fixtures | Run a filesystem org rescan against a local agent that has a `skills/` directory, open the agent Profile tab, click a linked skill chip, and confirm the visible source label matches `org-agent:<agent-name-slug>` and the displayed content is from that agent's `SKILL.md` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify without synthetic Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No `MISSING` verify placeholders remain
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
