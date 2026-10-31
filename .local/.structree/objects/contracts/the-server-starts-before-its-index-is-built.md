---
id: the-server-starts-before-its-index-is-built
name: the server starts before its index is built
title: The Server Starts Before Its Index Is Built
description: Normal serving admits source reads before optional projection startup; direct framework defaults and maintenance commands retain separate semantics.
createdAt: 2026-10-21T11:20:00.000Z
updatedAt: 2026-10-28T10:21:40.093Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/cli.ts
      role: implementation
    - root: project
      path: src/lib/resilient-runtime.ts
      role: implementation
    - root: project
      path: src/lib/source-access/index.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-defer-the-startup-reconciliation
---
# The Server Starts Before Its Index Is Built

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

Normal serve first establishes source access and supervises optional projection startup without awaiting it. Source get/list do not require a ready delegate; typed create/update/delete, relations and resync do. status reports source and capability separately. Search may return an explicitly degraded source-mode result while optional index readiness is absent. A direct ObjectFramework still waits by default unless waitForStartup:false, and explicit sync/status wait with watching disabled. Immediate direct-framework indexing after create is not a promise that every wrapper search returns indexed mode during background work. The original deferral ADR below is historical motivation, not a complete description of the later resilient composition.

## Typed References

- [[adrs/adr-defer-the-startup-reconciliation|adr-defer-the-startup-reconciliation]]

## Source Evidence

- implementation: `src/cli.ts`
- implementation: `src/lib/resilient-runtime.ts`
- implementation: `src/lib/source-access/index.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
