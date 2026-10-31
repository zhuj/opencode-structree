---
id: framework-lifecycle-events
name: Framework Lifecycle Events
title: Framework Lifecycle Events
description: Publishes process-local change notifications and owns shutdown of the framework resources.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-facade
  usedBy:
    - incomplete-scan-no-deletion
    - confirmed-conflict-invalidates
    - embedding-publication-guarded
    - concurrent-writes-serialized
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
    - adr-extract-library-and-adopt-vault
---
## Surface
src/lib/framework.ts - onEvent, requestResync and close.
## Behavior
Publishes process-local change notifications and owns shutdown of the framework resources.
## Guarantees
- A listener receives tool mutations, source changes and completed sync reports.
- A requested resync is coalesced with any pending reconciliation.
- Close drains in-flight work before releasing the watcher, provider and database.