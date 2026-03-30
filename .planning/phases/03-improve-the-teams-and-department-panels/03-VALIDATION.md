---
phase: 3
slug: improve-the-teams-and-department-panels
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test --run` |
| **Full suite command** | `pnpm test:all` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --run`
- **After every plan wave:** Run `pnpm test:all`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | D-01,D-02 | unit | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | D-03,D-04 | unit | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | D-06,D-07 | unit+integration | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | D-08,D-09,D-10 | unit+integration | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | D-13,D-14,D-15,D-16 | unit | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 1 | D-17,D-18 | unit+integration | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 1 | D-19,D-20 | unit | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-04-03 | 04 | 1 | D-21,D-22,D-23 | unit+integration | `pnpm test --run` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 1 | D-11,D-12,D-24,D-25 | unit | `pnpm test --run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for agent details card component rendering
- [ ] Test stubs for new API routes (POST /api/teams, POST /api/departments, POST /api/agents)
- [ ] Test stubs for filesystem creation operations
- [ ] Test stubs for org-scanner MANAGER/ directory handling
- [ ] Test stubs for department manager terminology rename

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent details card vertical tab layout | D-02 | Visual layout positioning | Open Teams panel → select team → verify tabs render vertically on left side |
| Chat agent selector creative design | D-14 | Visual/UX design quality | Open Chat tab → verify agent selector is not a basic dropdown |
| Button visual prominence | D-06,D-17 | Subjective styling | Verify action buttons are visually prominent in dark theme |
| Separator full-width fix | D-12,D-25 | Visual rendering | Verify separator lines span full panel width |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
