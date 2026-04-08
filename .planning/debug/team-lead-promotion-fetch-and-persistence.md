---
status: investigating
trigger: "Investigate issue: team-lead-promotion-fetch-and-persistence"
created: 2026-04-01T00:00:00Z
updated: 2026-04-01T00:20:00Z
---

## Current Focus

hypothesis: lead promotion is unstable because the client allows promotion in filesystem-backed org mode, but the API only writes a manual DB assignment while org rescans rebuild role state from filesystem metadata; fetch failures are likely a server-side route failure that needs route-level regression coverage to pin down
test: verify promote client path, inspect assignment API and scanner persistence rules, then add route/scanner regression tests around promote and rescan
expecting: confirm that rescans ignore promoted lead state unless assignment_role is written back to AGENT.md/IDENTITY.md, and determine whether the PATCH handler itself has a failing branch
next_action: add concrete evidence entries and inspect test harness/helpers before implementing a minimal filesystem-backed fix

## Symptoms

expected: Promoting a member to team lead should succeed reliably and persist across refreshes/org rescans.
actual: Sometimes the browser fetch fails during promote-to-lead. When it does work, the team lead does not persist.
errors: `TypeError: Failed to fetch` from `promoteToLead` in the client store.
reproduction: Open Teams panel, choose a member, click set/promote to lead, then refresh/rescan.
started: Not stable yet; current active bug.

## Eliminated

## Evidence

- timestamp: 2026-04-01T00:08:00Z
  checked: src/store/index.ts promoteToLead action
  found: Client issues PATCH /api/teams/${teamId}/assignments with { agent_id, role: 'lead' }, logs fetch failures from that request, then non-fatally triggers /api/org/scan?force=true and locally rewrites assignment roles in Zustand.
  implication: The browser error originates from the PATCH request itself, not the follow-up rescan request.

- timestamp: 2026-04-01T00:10:00Z
  checked: src/app/api/teams/[id]/assignments/route.ts
  found: PATCH validates membership, demotes any existing lead, updates the selected assignment to role='lead', marks both rows source='manual', and invalidates the org snapshot. It does not touch filesystem metadata.
  implication: Any successful promote is persisted only in DB assignment rows.

- timestamp: 2026-04-01T00:13:00Z
  checked: src/lib/org-scanner.ts parseAgentMetadata and scanFilesystemOrg
  found: Filesystem scans derive assignment role only from assignment_role/team_role/org_role fields in AGENT.md or IDENTITY.md, then rebuild OrgSnapshot.agentAssignments from that filesystem-derived data before applying DB upserts.
  implication: Refresh/rescan in filesystem mode cannot reconstruct a promoted lead unless the role is written into agent filesystem metadata.

- timestamp: 2026-04-01T00:15:00Z
  checked: src/lib/org-scanner.ts applyFilesystemOrgPersistence
  found: Filesystem assignment upserts preserve manual DB role/source when a matching assignment row already exists, but the in-memory OrgSnapshot returned to the UI is still built from the filesystem-derived agentAssignments array.
  implication: Manual DB overrides may survive in the table yet still disappear from the UI after refresh because the snapshot payload ignores them.

- timestamp: 2026-04-01T00:18:00Z
  checked: src/components/panels/teams-panel.tsx and src/lib/use-org-data.ts
  found: useOrgData flags filesystem orgs as read-only, but the promote button path does not check isReadOnly before allowing promote.
  implication: The UI currently exposes a mutation path in filesystem mode without a matching filesystem persistence mechanism.
## Resolution

root_cause:
fix:
verification:
files_changed: []
