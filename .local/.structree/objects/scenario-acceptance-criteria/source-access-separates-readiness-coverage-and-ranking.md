---
id: source-access-separates-readiness-coverage-and-ranking
name: Resilient Source Access And Search Observable Boundary
title: Resilient Source Access And Search Observable Boundary
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
  scenario: keep-source-readable-when-derived-capabilities-fail
  dependsOn: []
---
# Resilient Source Access And Search Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given an optional startup failure, source get/list still return readable content. A known target with incomplete sibling coverage carries unverified identity assurance; an uncertain absent target yields SCAN, not NOT_FOUND. Before delegate readiness mutations return CAPABILITY_UNAVAILABLE; after readiness they delegate. Degraded search must label source-mode matching and not fabricate indexed or semantic evidence.

## Traceability

- [[scenarios/keep-source-readable-when-derived-capabilities-fail|keep-source-readable-when-derived-capabilities-fail]]

## Source Evidence

- implementation: `src/lib/source-access/index.ts`
- implementation: `src/lib/source-access/search-operation.ts`
- implementation: `src/lib/resilient-runtime.ts`
- test: `test/source-access.test.ts`
- test: `test/source-search.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
