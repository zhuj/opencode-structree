---
id: lifecycle-test
name: lifecycle.test.ts
title: Lifecycle Test
description: Tests cancellation, shutdown draining and deferred embedding convergence across framework instances.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-lifecycle-close-drains
  commitsTo:
    - coordination-lock-file
    - markdown-source-file
    - sqlite-metadata-row
---
## File
test/lifecycle.test.ts
## What it covers
independent framework instances cannot both update the same source revision | cancelling a writer waiting for the process lock leaves no file and permits later writes | cancelling one resync waiter does not cancel shared indexing for another waiter | close drains every embedding worker before disposing the provider or database | close attempts every owned resource despite multiple cleanup failures | a startup error is retained when cleanup also fails | a partial vault walk cannot remove cached objects that it could not observe | deletion during deferred embedding converges within the shared resync without a watcher | rename during deferred embedding indexes the new path within the shared resync without a watcher | an encoding failure during publication is reported instead of being treated as an absent source
## Verifies
serialized-cross-process-writes, lock-timeout-and-cancellation, partial-scan-preserves-cache, resync-index-reconciliation
## Exercises
coordination-lock-file, markdown-source-file, sqlite-metadata-row