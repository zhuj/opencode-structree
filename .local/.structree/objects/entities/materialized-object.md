---
id: materialized-object
name: Materialized Object
title: Materialized Object
description: Observed implementation of Typed Vault Materialization.
createdAt: 2026-10-28T10:17:17.157Z
updatedAt: 2026-10-28T10:17:17.157Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/materialization/index.ts
      role: implementation
    - root: project
      path: src/lib/materialization/validate.ts
      role: implementation
    - root: project
      path: src/lib/model/index.ts
      role: implementation
    - root: project
      path: test/materialization.test.ts
      role: test
    - root: project
      path: docs/materialization.md
      role: documentation
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - data-only-owned-materialization
  usedIn:
    - materialization-api
  commitsTo: []
---
# Materialized Object

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

MaterializedObject carries the exact type/id pair, JSON header, body, vault-relative source path/checksum, declared semantic references and explicit project file bindings. createObjectGraph resolves by tuple identity and rejects duplicate pairs. Headers preserve encoded timestamps rather than claiming decoded Date values.

## Traceability

- [[contracts/data-only-owned-materialization|data-only-owned-materialization]]
- [[interfaces/materialization-api|materialization-api]]

## Source Evidence

- implementation: `src/lib/materialization/index.ts`
- implementation: `src/lib/materialization/validate.ts`
- implementation: `src/lib/model/index.ts`
- test: `test/materialization.test.ts`
- documentation: `docs/materialization.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or snapshot freshness.
