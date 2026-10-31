---
id: process-coordination-lock
name: process lock
title: Process Coordination Lock
description: Serializes writes across framework instances on one root through a dedicated SQLite coordination database.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
## What it does
Serializes writes across framework instances on one root through a dedicated SQLite coordination database.

## Where it lives
src/lib/sqlite/process-lock.ts, src/lib/filesystem.ts

## Scenarios
serialized-cross-process-writes, lock-timeout-and-cancellation

## Verification
test/process-lock.test.ts | test/lifecycle.test.ts