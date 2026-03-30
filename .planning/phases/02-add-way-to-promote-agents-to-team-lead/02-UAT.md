---
status: testing
phase: 02-add-way-to-promote-agents-to-team-lead
source:
  - 02-00-SUMMARY.md
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
started: 2026-03-30T08:57:16Z
updated: 2026-03-30T08:57:16Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 2
name: Promote a Team Member to Lead
expected: |
  In the teams panel, a non-lead roster member shows an inline "promote to lead?" confirmation flow. Confirming it succeeds without a page reload and updates that member to lead status.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running app process and start the application from scratch. Startup should complete without errors, any migrations should finish cleanly, and the main UI or a basic health/API check should load with live org data instead of a blank or failed state.
result: pass

### 2. Promote a Team Member to Lead
expected: In the teams panel, a non-lead roster member shows an inline "promote to lead?" confirmation flow. Confirming it succeeds without a page reload and updates that member to lead status.
result: pending

### 3. Team Lead Badge and Single-Lead Refresh
expected: After a promotion, the promoted member shows a clear lead badge in the team roster, and org data refreshes so the team reflects one current lead rather than stale or conflicting lead markers.
result: pending

### 4. Department Lead Selector
expected: In the department overview, a department lead selector is visible and lets you choose or clear the department lead through the UI without breaking the page.
result: pending

### 5. Department Lead Persistence After Refresh
expected: After setting a department lead, reloading or forcing an org refresh keeps the selected lead in place, and department/team views continue to show the updated lead information.
result: pending

## Summary

total: 5
passed: 0
passed: 1
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

[]
