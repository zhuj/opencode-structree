---
id: source-repair-requires-approval-revision-and-backup
name: Explicit Source Repair Observable Boundary
title: Explicit Source Repair Observable Boundary
description: Observed implementation of Explicit Source Repair.
createdAt: 2026-10-28T10:19:46.863Z
updatedAt: 2026-10-28T10:19:46.863Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/source-repair/session.ts
      role: implementation
    - root: project
      path: src/lib/source-repair/apply.ts
      role: implementation
    - root: project
      path: src/repair-cli.ts
      role: implementation
    - root: project
      path: src/lib/source-repair-mcp.ts
      role: implementation
    - root: project
      path: test/source-repair-core.test.ts
      role: test
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  scenario: plan-approve-and-guard-source-repair
  dependsOn: []
---
# Explicit Source Repair Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given an inert exact-byte plan, applying without approved:true is refused and source bytes remain unchanged. Approved replacement preserves exact prior bytes in its backup. Stale or tampered plans and mismatched preexisting backups are refused before overwrite. Draft/salvage use exclusive creation and retain original source; rollback cannot overwrite later edits. A plan action ID is not operator authorization.

## Traceability

- [[scenarios/plan-approve-and-guard-source-repair|plan-approve-and-guard-source-repair]]

## Source Evidence

- implementation: `src/lib/source-repair/session.ts`
- implementation: `src/lib/source-repair/apply.ts`
- implementation: `src/repair-cli.ts`
- implementation: `src/lib/source-repair-mcp.ts`
- test: `test/source-repair-core.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
