---
phase: 5
slug: skills-import-and-linking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-08
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test --reporter=verbose` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --reporter=verbose`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SKIL-01 | unit | `pnpm test -- skill-import` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | SKIL-01 | unit | `pnpm test -- skill-sync` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | SKIL-02 | unit | `pnpm test -- profile-chip` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for `importAgentSkillsFromPath` — SKIL-01 import logic
- [ ] Test stubs for `syncSkillsFromDisk` non-interference — SKIL-01 isolation
- [ ] Test stubs for `ProfileChip` skill linking — SKIL-02 UI behavior

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clickable skill chips navigate to correct skill detail | SKIL-02 | Visual UI behavior with drawer/navigation | 1. Open agent profile with skills 2. Click a skill chip that matches a catalog entry 3. Verify skill detail opens with correct content |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
