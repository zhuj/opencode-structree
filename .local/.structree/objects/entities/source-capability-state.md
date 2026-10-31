---
id: source-capability-state
name: Source Capability State
title: Source Capability State
description: Observed implementation of Resilient Source Access And Search.
createdAt: 2026-10-28T10:18:17.523Z
updatedAt: 2026-10-28T10:18:17.523Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/source-access/index.ts
      role: implementation
    - root: project
      path: src/lib/source-access/search-operation.ts
      role: implementation
    - root: project
      path: src/lib/resilient-runtime.ts
      role: implementation
    - root: project
      path: test/source-access.test.ts
      role: test
    - root: project
      path: test/source-search.test.ts
      role: test
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - source-availability-is-independent-of-derived-readiness
  usedIn:
    - source-access-runtime-api
  commitsTo: []
---
# Source Capability State

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

CapabilityReadiness is idle, starting, ready, failed with CAPABILITY_START_FAILED, or closed. It is independent of sourceAvailable and source-read mode. A ready state resolves a resource-owning ObjectFacade; wrapper close drains source reads/startup and closes the delegate, while delegated-operation draining remains the delegate responsibility.

## Traceability

- [[contracts/source-availability-is-independent-of-derived-readiness|source-availability-is-independent-of-derived-readiness]]
- [[interfaces/source-access-runtime-api|source-access-runtime-api]]

## Source Evidence

- implementation: `src/lib/source-access/index.ts`
- implementation: `src/lib/source-access/search-operation.ts`
- implementation: `src/lib/resilient-runtime.ts`
- test: `test/source-access.test.ts`
- test: `test/source-search.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
