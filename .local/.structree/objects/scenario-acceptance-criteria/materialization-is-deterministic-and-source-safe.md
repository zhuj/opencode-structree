---
id: materialization-is-deterministic-and-source-safe
name: Typed Vault Materialization Observable Boundary
title: Typed Vault Materialization Observable Boundary
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
  scenario: validate-and-materialize-vault
  dependsOn: []
---
# Typed Vault Materialization Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given valid stable vault sources, repeated materialization produces the same manifest and check mode observes no drift after publication. Given partial sources or edited generated output, publication is refused and existing bytes are preserved. Missing output in check mode is drift, not permission to generate it.

## Traceability

- [[scenarios/validate-and-materialize-vault|validate-and-materialize-vault]]

## Source Evidence

- implementation: `src/lib/materialization/index.ts`
- implementation: `src/lib/materialization/validate.ts`
- implementation: `src/lib/model/index.ts`
- test: `test/materialization.test.ts`
- documentation: `docs/materialization.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or snapshot freshness.
