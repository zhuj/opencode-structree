---
id: sqlite-process-lock
name: SQLite Process Lock
title: SQLite Process Lock
description: Coordinates writers across processes and threads through a dedicated coordination database.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - concurrent-writes-serialized
    - lock-wait-cancellable
    - lock-file-holds-no-object-data
  commitsTo:
    - adr-database-table-abstractions
    - adr-filesystem-commit-and-reconciliation
---
## Surface
src/lib/sqlite/process-lock.ts - the SqliteProcessLock class.
## Behavior
Coordinates writers across processes and threads through a dedicated coordination database.
## Guarantees
- The lock is held for the whole callback, including its asynchronous part.
- Acquisition retries asynchronously so the event loop is never blocked.
- A cancelled or timed-out wait leaves the lock free for the next caller.