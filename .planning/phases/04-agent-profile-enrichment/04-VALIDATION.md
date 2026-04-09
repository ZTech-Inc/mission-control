---
phase: 4
slug: agent-profile-enrichment
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
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
| 04-01-01 | 01 | 1 | PROF-01 | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts` | ✅ | ✅ green |
| 04-01-02 | 01 | 1 | PROF-02 | unit | `pnpm typecheck` | ✅ | ✅ green |
| 04-02-01 | 02 | 2 | PROF-03 | unit | `pnpm test -- --run src/lib/__tests__/agent-profile-parser.test.ts` | ✅ | ✅ green |
| 04-03-01 | 03 | 3 | PROF-03 | integration | `pnpm test -- --run src/lib/__tests__/org-scanner-profile-rescan.test.ts src/lib/__tests__/agent-profile-parser.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Test coverage for profile column persistence through the real org scanner path
- [x] Test coverage for org-scanner profile field parsing
- [x] Test coverage for openclawId derivation consistency
- [x] Test coverage for agent-store refresh after `/api/org/scan`

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent detail panel renders structured profile fields | PROF-01 | Visual UI rendering | Open agent detail, verify skills/KPIs/protocol stack render as structured fields not JSON blob |
| Org rescan preserves manually assigned lead roles | PROF-03 | Requires manual role assignment first | Assign lead role, trigger rescan, verify role preserved |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
