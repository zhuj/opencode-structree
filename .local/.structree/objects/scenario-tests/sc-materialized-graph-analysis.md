---
id: sc-materialized-graph-analysis
name: Materialized Graph Analysis And Diff Scenario Evidence
title: Materialized Graph Analysis And Diff Scenario Evidence
description: Source-inspected test evidence for Materialized Graph Analysis And Diff.
createdAt: 2026-10-28T10:17:17.157Z
updatedAt: 2026-10-28T10:17:17.157Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/graph-tools/impact.ts
      role: implementation
    - root: project
      path: src/lib/graph-tools/lookup.ts
      role: implementation
    - root: project
      path: src/lib/graph-tools/diagram.ts
      role: implementation
    - root: project
      path: src/lib/graph-tools/traceability.ts
      role: implementation
    - root: project
      path: src/lib/graph-diff/index.ts
      role: implementation
    - root: project
      path: src/graph-tools-cli.ts
      role: implementation
    - root: project
      path: test/graph-tools-impact.test.ts
      role: test
    - root: project
      path: test/graph-diff.test.ts
      role: test
    - root: project
      path: docs/materialization.md
      role: documentation
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-materialized-graph-analysis
  commitsTo:
    - materialized-graph-tools
---
# Materialized Graph Analysis And Diff Scenario Evidence

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

test/graph-tools-impact.test.ts asserts deterministic closed reverse BFS, stable shortest-path ties, role/symbol-preserving binding aggregation, retirement filtering and exclusion of relates. test/graph-diff.test.ts asserts order normalization without mutation, sorted added/removed identities and changed nested header leaves.

## Traceability

- [[acceptance-tests/acceptance-materialized-graph-analysis|acceptance-materialized-graph-analysis]]
- [[interfaces/materialized-graph-tools|materialized-graph-tools]]

## Source Evidence

- implementation: `src/lib/graph-tools/impact.ts`
- implementation: `src/lib/graph-tools/lookup.ts`
- implementation: `src/lib/graph-tools/diagram.ts`
- implementation: `src/lib/graph-tools/traceability.ts`
- implementation: `src/lib/graph-diff/index.ts`
- implementation: `src/graph-tools-cli.ts`
- test: `test/graph-tools-impact.test.ts`
- test: `test/graph-diff.test.ts`
- documentation: `docs/materialization.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or snapshot freshness.
