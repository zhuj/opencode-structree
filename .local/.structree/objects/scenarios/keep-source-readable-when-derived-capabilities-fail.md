---
id: keep-source-readable-when-derived-capabilities-fail
name: Resilient Source Access And Search Workflow
title: Resilient Source Access And Search Workflow
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
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - resilient-source-access
---
# Resilient Source Access And Search Workflow

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Source get/list use a noncreating read-only store independently of optional facade startup. Typed writes, relations and resync delegate only when capability is ready. status source:"read-only" describes the source layer, not a global writer denial. Missing/failed optional capability does not hide readable files. Incomplete discovery cannot establish absence; observed duplicates are refused. Source fallback search reports mode:"source", requestedMode, null generation/ranks and coverage; it is token-based matching, not successful semantic/BM25 search. Normal serve uses a supervised projection facade without model preparation.

## Traceability

- [[projects/structree-initial|structree-initial]]
- [[features/resilient-source-access|resilient-source-access]]
- [[scenario-acceptance-criteria/source-access-separates-readiness-coverage-and-ranking|source-access-separates-readiness-coverage-and-ranking]]

## Source Evidence

- implementation: `src/lib/source-access/index.ts`
- implementation: `src/lib/source-access/search-operation.ts`
- implementation: `src/lib/resilient-runtime.ts`
- test: `test/source-access.test.ts`
- test: `test/source-search.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
