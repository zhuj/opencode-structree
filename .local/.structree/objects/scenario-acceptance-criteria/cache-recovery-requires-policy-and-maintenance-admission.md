---
id: cache-recovery-requires-policy-and-maintenance-admission
name: Opt-In Offline Cache Recovery Observable Boundary
title: Opt-In Offline Cache Recovery Observable Boundary
description: Observed implementation of Opt-In Offline Cache Recovery.
createdAt: 2026-10-28T10:19:46.863Z
updatedAt: 2026-10-28T10:19:46.863Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/cache-recovery/controller.ts
      role: implementation
    - root: project
      path: src/lib/cache-recovery/controller-types.ts
      role: implementation
    - root: project
      path: test/cache-recovery-controller.test.ts
      role: test
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  scenario: rebuild-a-dedicated-cache-under-exclusive-maintenance
  dependsOn: []
---
# Opt-In Offline Cache Recovery Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given no exclusive-maintenance capability, recover returns blocked/MAINTENANCE_REQUIRED before filesystem effects. Given an admitted synthetic dedicated-cache fixture, the controller rebuilds metadata/text in an owned child, leaves source bytes unchanged, retains exact old-cache bytes and returns semantic:"unavailable". Restart can report already-satisfied for a revision-proven current result. This is not approval to recover the actual project cache.

## Traceability

- [[scenarios/rebuild-a-dedicated-cache-under-exclusive-maintenance|rebuild-a-dedicated-cache-under-exclusive-maintenance]]

## Source Evidence

- implementation: `src/lib/cache-recovery/controller.ts`
- implementation: `src/lib/cache-recovery/controller-types.ts`
- test: `test/cache-recovery-controller.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
