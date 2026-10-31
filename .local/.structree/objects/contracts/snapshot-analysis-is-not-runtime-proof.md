---
id: snapshot-analysis-is-not-runtime-proof
name: Materialized Graph Analysis And Diff Contract
title: Materialized Graph Analysis And Diff Contract
description: Observed implementation of Materialized Graph Analysis And Diff.
createdAt: 2026-10-28T10:17:17.157Z
updatedAt: 2026-10-31T13:25:16.269Z
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
    - root: project
      path: scripts/materialization-gate.ts
      role: implementation
    - root: project
      path: scripts/materialization-watch.ts
      role: implementation
relations:
  partOf: null
  dependsOn:
    - data-only-owned-materialization
  commitsTo: []
---
# Materialized Graph Analysis And Diff Contract

Graph-analysis baseline: 2026-10-28; daily-workflow evidence refreshed: 2026-10-31. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Pure graph tools support explicit-root file lookup, deterministic reverse breadth-first impact with candidate bindings, traceability, escaped Mermaid output and semantic comparison of two snapshots. The CLI loads graph.ts from the selected output rather than scanning or repairing the live vault. Snapshot impact follows incoming selected reference kinds, excludes relates, and is distinct from the live objects_relations propagation contract. Diff distinguishes header, reference, binding, body and source provenance changes; ignoreBody does not suppress checksum changes.

## Traceability

- [[contracts/data-only-owned-materialization|data-only-owned-materialization]]

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

## Strict Daily Workflow Gate And Development Watcher

`bun run gate:materialization` runs source validation, refuses any partial objects, then checks materialized drift with check:true without writing generated output. Exit 0 means strict-clean, 2 means invalid/partial sources or drift, and 1 means usage/configuration/runtime failure. It does not start the normal framework or prepare embeddings. A pass applies only to the checked state and is not runtime/test proof.

`bun run watch:materialization` is a development-only writer, not a CI gate. It performs an initial cycle and debounces source Markdown events by 500ms. Invalid or partial sources are reported without publication, preserving prior good output; strictly valid cycles invoke materialization with check:false. Running it requires generated-output write authorization. Both commands accept --config and --out.

Source evidence: scripts/materialization-gate.ts:16-81; scripts/materialization-watch.ts:13-127. Delivery evidence: .local/.progress/2026-10-23-2355-graph-tools-diff-workflow.md:74-85. Historical reported gate and watcher results are not new checks; neither command was executed in this extraction.

This qualifies [[features/materialized-graph-analysis|Materialized Graph Analysis And Diff]], not a new runtime guarantee.
