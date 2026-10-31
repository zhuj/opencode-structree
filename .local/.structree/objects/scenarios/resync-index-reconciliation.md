---
id: resync-index-reconciliation
name: resync
title: Resync Index Reconciliation
description: Scans the sources, upserts changed documents, removes vanished ones and reports the indexed, unchanged and deleted counts.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:22:56.450Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/framework.ts
      role: implementation
    - root: project
      path: src/lib/resilient-runtime.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - filesystem-reconciliation
      - sqlite-index-and-search
---
# Resync Index Reconciliation

Last refreshed: 2026-10-28.

## Current Workflow

Resync scans source documents and reports reconciliation counts/issues while refreshing derived metadata/text. Maintenance is the direct-framework default: validated filename alignment and embedding work may occur. The normal resilient server chooses projection instead, without source renames or embedding jobs. Incomplete or issue-bearing projection scans preserve unseen rows conservatively; confirmed duplicate identities can still be invalidated. Partial readable content is not silently repaired. The wrapper requires optional capability readiness before delegating resync.

The original criterion IDs remain valid traceability anchors, not evidence that a pass ran today. See [[scenario-acceptance-criteria/resync-reports-reconciliation-counts|Reconciliation counts]] and [[scenario-acceptance-criteria/resync-keeps-metadata-in-sync|Metadata refresh]].

## Typed References

- [[projects/structree-initial|structree-initial]]
- [[features/filesystem-reconciliation|filesystem-reconciliation]]
- [[features/sqlite-index-and-search|sqlite-index-and-search]]

## Refresh Source Bindings

- implementation: `src/lib/framework.ts`
- implementation: `src/lib/resilient-runtime.ts`
- documentation: `docs/recovery.md`
