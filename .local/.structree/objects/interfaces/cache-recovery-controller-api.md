---
id: cache-recovery-controller-api
name: Opt-In Offline Cache Recovery API
title: Opt-In Offline Cache Recovery API
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
  partOf: null
  dependsOn: []
  usedBy:
    - cache-recovery-is-not-automatic-runtime-repair
  commitsTo: []
---
# Opt-In Offline Cache Recovery API

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

createCacheRecoveryController is a host-admitted library capability, not automatic MCP/runtime repair. enabled, allowSemanticReset and a trusted nonserialized exclusive-maintenance callback are required before a job. It supports an existing dedicated current-format cache, not the source coordinator or arbitrary unknown database. An owned Bun child rebuilds metadata/lexical state, rechecks source coverage and retains exact old-cache bytes before guarded publication. Successful outcomes explicitly leave semantic search unavailable. Missing policy/maintenance, unsafe paths, unknown ownership or unresolved state block instead of guessing.

## Traceability

- [[contracts/cache-recovery-is-not-automatic-runtime-repair|cache-recovery-is-not-automatic-runtime-repair]]

## Source Evidence

- implementation: `src/lib/cache-recovery/controller.ts`
- implementation: `src/lib/cache-recovery/controller-types.ts`
- test: `test/cache-recovery-controller.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
