---
id: model-snapshot-is-fetched-at-startup
name: Model Snapshot Is Fetched At Startup
title: Model Snapshot Is Fetched At Startup
description: Explicit model preparation fetches permitted missing pinned snapshots; normal resilient serve does not prepare models.
createdAt: 2026-10-21T04:40:00.000Z
updatedAt: 2026-10-28T10:21:41.120Z
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
      path: docs/recovery.md
      role: documentation
    - root: project
      path: docs/embeddings.md
      role: documentation
relations:
  scenario: embedding-provider-failures
  dependsOn: []
---
# Model Snapshot Is Fetched At Startup

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

When preparation is explicitly invoked (including maintenance sync), embeddings.localFilesOnly:false permits a missing pinned snapshot to be fetched; a complete snapshot is reused, and offline-only mode retains MODEL_NOT_CACHED. Normal resilient serve does not call preparation. Direct library hosts decide whether to prepare. This scopes the historical startup criterion rather than claiming that every server startup fetches model assets. No download or model preparation was performed during this refresh.

## Typed References

- [[scenarios/embedding-provider-failures|embedding-provider-failures]]

## Source Evidence

- implementation: `src/cli.ts`
- implementation: `src/lib/resilient-runtime.ts`
- documentation: `docs/recovery.md`
- documentation: `docs/embeddings.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
