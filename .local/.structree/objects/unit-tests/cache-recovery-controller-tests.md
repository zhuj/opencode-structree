---
id: cache-recovery-controller-tests
name: Opt-In Offline Cache Recovery Test Suite
title: Opt-In Offline Cache Recovery Test Suite
description: Source-inspected test evidence for Opt-In Offline Cache Recovery.
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
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-opt-in-offline-cache-recovery
  commitsTo:
    - cache-recovery-outcome
---
# Opt-In Offline Cache Recovery Test Suite

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

test/cache-recovery-controller.test.ts asserts "blocks missing maintenance capability before filesystem effects" and "rebuilds lexical metadata in an owned Bun child and retains the exact old cache". The latter checks maintenance calls, unchanged source, byte-exact retained old cache and restart already-satisfied handling using synthetic fixtures.

## Traceability

- [[scenario-tests/sc-opt-in-offline-cache-recovery|sc-opt-in-offline-cache-recovery]]
- [[entities/cache-recovery-outcome|cache-recovery-outcome]]

## Source Evidence

- implementation: `src/lib/cache-recovery/controller.ts`
- implementation: `src/lib/cache-recovery/controller-types.ts`
- test: `test/cache-recovery-controller.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
