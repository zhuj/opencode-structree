---
id: materialized-graph-tools
name: Materialized Graph Analysis And Diff API
title: Materialized Graph Analysis And Diff API
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
  partOf: null
  dependsOn:
    - materialization-api
  usedBy:
    - snapshot-analysis-is-not-runtime-proof
  commitsTo: []
---
# Materialized Graph Analysis And Diff API

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Pure graph tools support explicit-root file lookup, deterministic reverse breadth-first impact with candidate bindings, traceability, escaped Mermaid output and semantic comparison of two snapshots. The CLI loads graph.ts from the selected output rather than scanning or repairing the live vault. Snapshot impact follows incoming selected reference kinds, excludes relates, and is distinct from the live objects_relations propagation contract. Diff distinguishes header, reference, binding, body and source provenance changes; ignoreBody does not suppress checksum changes.

## Traceability

- [[contracts/snapshot-analysis-is-not-runtime-proof|snapshot-analysis-is-not-runtime-proof]]
- [[interfaces/materialization-api|materialization-api]]

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
