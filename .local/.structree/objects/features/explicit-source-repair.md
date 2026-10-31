---
id: explicit-source-repair
name: Explicit Source Repair
title: Explicit Source Repair
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
  project: structree-initial
  commitment:
    goals: []
---
# Explicit Source Repair

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

createSourceRepairSession opens an existing confined root without writer coordination merely for planning. It plans byte replacement, patch, exclusive draft and salvage; approved apply uses ordinary source coordination, whole-source revision guards and exact backup bytes. Approval is a separate argument captured with owned plan data before asynchronous admission. Rollback is replacement-only and refuses later edits. Successful source commit reports indexState:"not-updated"; no implicit reconciliation, YAML reconstruction or model work follows. This is separate from strict typed CRUD.

## Traceability

- [[projects/structree-initial|structree-initial]]
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
