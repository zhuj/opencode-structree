---
id: materialization-tests
name: Typed Vault Materialization Test Suite
title: Typed Vault Materialization Test Suite
description: Source-inspected test evidence for Typed Vault Materialization.
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
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-typed-vault-materialization
  commitsTo:
    - materialized-object
---
# Typed Vault Materialization Test Suite

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

The tests "validation and check are read-only; output is deterministic and imports a pure model", "partial source survives validation but prevents publication", "reports duplicate identities and dangling references with paths and fields" and "refuses handwritten and edited generated files without changing last-good outputs" assert these boundaries.

## Traceability

- [[scenario-tests/sc-typed-vault-materialization|sc-typed-vault-materialization]]
- [[entities/materialized-object|materialized-object]]

## Source Evidence

- implementation: `src/lib/materialization/index.ts`
- implementation: `src/lib/materialization/validate.ts`
- implementation: `src/lib/model/index.ts`
- test: `test/materialization.test.ts`
- documentation: `docs/materialization.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or snapshot freshness.
