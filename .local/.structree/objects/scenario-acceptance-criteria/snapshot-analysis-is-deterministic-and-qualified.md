---
id: snapshot-analysis-is-deterministic-and-qualified
name: Materialized Graph Analysis And Diff Observable Boundary
title: Materialized Graph Analysis And Diff Observable Boundary
description: Observed implementation of Materialized Graph Analysis And Diff.
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
relations:
  scenario: inspect-and-compare-materialized-graphs
  dependsOn: []
---
# Materialized Graph Analysis And Diff Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given reordered equivalent snapshot inputs, impact/diff results remain deterministic without input mutation. Impact reports shortest chains and candidate file bindings, respects depth/kind/retirement options and never treats relates as impact. A snapshot comparison reports added/removed type-id identities and changed header leaves. Results describe recorded structure, not executed tests or source freshness.

## Traceability

- [[scenarios/inspect-and-compare-materialized-graphs|inspect-and-compare-materialized-graphs]]

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
