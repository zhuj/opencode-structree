---
id: sc-explicit-source-repair
name: Explicit Source Repair Scenario Evidence
title: Explicit Source Repair Scenario Evidence
description: Source-inspected test evidence for Explicit Source Repair.
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
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-explicit-source-repair
  commitsTo:
    - source-repair-session-api
---
# Explicit Source Repair Scenario Evidence

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

test/source-repair-core.test.ts asserts explicit approval before replacement, original-offset byte patches with copied insertion buffers, mismatched-backup refusal, confined source access, stale/tampered-plan refusal, exclusive drafts and salvage, and guarded replacement rollback. No repair was applied to live project sources during this refresh.

## Traceability

- [[acceptance-tests/acceptance-explicit-source-repair|acceptance-explicit-source-repair]]
- [[interfaces/source-repair-session-api|source-repair-session-api]]

## Source Evidence

- implementation: `src/lib/source-repair/session.ts`
- implementation: `src/lib/source-repair/apply.ts`
- implementation: `src/repair-cli.ts`
- implementation: `src/lib/source-repair-mcp.ts`
- test: `test/source-repair-core.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
