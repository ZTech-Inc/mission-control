---
phase: 02
slug: add-way-to-promote-agents-to-team-lead
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit), playwright (e2e) |
| **Config file** | vitest.config.ts, playwright.config.ts |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test:all` |
| **Estimated runtime** | ~30 seconds (unit), ~120 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test:all`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | DB migration | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | API routes | integration | `pnpm test` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | UI promotion | e2e | `pnpm test:e2e` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for API route handlers (team assignment PATCH, department lead PUT)
- [ ] Test stubs for migration (manager_agent_id column exists)
- [ ] Existing test infrastructure covers framework setup

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Inline confirmation UX | D-10 | Visual interaction | Click promote button, verify confirmation appears before role change |
| Lead badge display | D-12 | Visual rendering | Verify lead has distinct visual indicator in member list |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
