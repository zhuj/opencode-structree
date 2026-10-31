---
id: model-snapshot-prepared-at-startup
name: The Model Snapshot Is Prepared At Startup
title: The Model Snapshot Is Prepared At Startup
description: A missing pinned snapshot is fetched at startup when the configuration permits it, and the refusal stays available.
createdAt: 2026-10-21T04:40:00.000Z
updatedAt: 2026-10-28T10:22:54.964Z
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
      path: src/lib/framework.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
    - root: project
      path: docs/embeddings.md
      role: documentation
relations:
  partOf: null
  dependsOn:
    - cache-outside-source-root
  commitsTo:
    - adr-prepare-the-model-snapshot-at-startup
---
# The Model Snapshot Is Prepared At Startup

Last refreshed: 2026-10-28.

## Current Boundary

The provider can ensure a pinned snapshot without loading inference. Permitted preparation may fetch missing files; complete snapshots are reused and localFilesOnly retains offline refusal. Normal resilient serve does not call preparation. Explicit maintenance sync invokes prepareEmbeddings, while status does not. Library hosts choose whether to invoke it. A failure is recorded/rethrown by the framework and caught by the sync host without turning a lexical/source path into semantic success. Historical serve preparation in the original ADR is not current runtime behavior. No model operation was performed during this refresh.

## Typed References

- [[contracts/cache-outside-source-root|cache-outside-source-root]]
- [[adrs/adr-prepare-the-model-snapshot-at-startup|adr-prepare-the-model-snapshot-at-startup]]

## Refresh Source Bindings

- implementation: `src/cli.ts`
- implementation: `src/lib/resilient-runtime.ts`
- implementation: `src/lib/framework.ts`
- documentation: `docs/recovery.md`
- documentation: `docs/embeddings.md`
