---
id: process-lock-test
name: process-lock.test.ts
title: Process Lock Test
description: Verifies cross-instance lock contention, timeout, cancellation and lock file requirements.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-lock-contention
    - sc-lock-callback-failure
    - sc-lock-cancellation
  commitsTo:
    - coordination-lock-file
---
## File
test/process-lock.test.ts
## What it covers
separate instances contend without blocking the event loop and recover after timeout | one instance serializes its callers and releases the transaction after callback failure | queued and SQLite-busy cancellation reject promptly without invoking either callback | active cancellation keeps the lock until work settles and close drains accepted operations | process locks require a shared file instead of a private in-memory database
## Verifies
serialized-cross-process-writes, lock-timeout-and-cancellation
## Exercises
coordination-lock-file