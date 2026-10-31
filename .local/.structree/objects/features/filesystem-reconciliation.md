---
id: filesystem-reconciliation
name: reconciliation
title: Filesystem Reconciliation
description: Reconciles derived state with distinct maintenance and source-preserving projection policies.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:37.079Z
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
  commitment:
    goals:
      - initial-implementation
---
# Filesystem Reconciliation

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

ObjectFramework defaults to maintenance reconciliation, which may align validated filenames to IDs and schedule embedding work. Normal resilient serve selects projection reconciliation: derived metadata/full-text refresh without filename alignment or embedding jobs. Partial readable inputs remain indexable but are not repaired/renamed; incomplete coverage conservatively prevents unseen-row deletion. A failed first pass does not destroy an installed watcher, though the original startup promise remains rejected. No claim that every reconciliation is read-only is valid. See [[features/tolerant-document-reads|Tolerant reads]] and [[features/resilient-source-access|Source-first serving]].

## Typed References

- [[projects/structree-initial|structree-initial]]
- [[project-goals/initial-implementation|initial-implementation]]

## Source Evidence

- implementation: `src/lib/framework.ts`
- implementation: `src/lib/resilient-runtime.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
