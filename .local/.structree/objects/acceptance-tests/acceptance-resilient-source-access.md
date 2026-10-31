---
id: acceptance-resilient-source-access
name: Resilient Source Access And Search Acceptance Evidence
title: Resilient Source Access And Search Acceptance Evidence
description: Source-inspected test evidence for Resilient Source Access And Search.
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
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - source-access-separates-readiness-coverage-and-ranking
---
# Resilient Source Access And Search Acceptance Evidence

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

test/source-access.test.ts asserts failed-startup readability, incomplete coverage/SCAN, duplicate refusal, cancellation, readiness-gated delegation and idempotent close. test/source-search.test.ts includes "AND-matches folded tokens, preserves partial metadata, and controls body disclosure"; the source fallback explicitly returns a different response mode rather than a semantic rank.

## Traceability

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
