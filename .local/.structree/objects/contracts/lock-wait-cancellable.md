---
id: lock-wait-cancellable
name: Lock Wait Is Cancellable
title: Lock Wait Is Cancellable
description: Waiting for the coordination lock never blocks the event loop.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - concurrent-writes-serialized
  commitsTo:
    - adr-database-table-abstractions
    - adr-filesystem-commit-and-reconciliation
---
## Rule
Lock acquisition MUST retry asynchronously, MUST honor an aborted signal, and MUST fail with LOCK_TIMEOUT after the configured timeout instead of waiting indefinitely.
## Evidence
src/lib/sqlite/process-lock.ts:96-122; src/lib/sqlite/process-lock.ts:133-143
## Why it matters
A blocked wait would stall every other request served by the same process.