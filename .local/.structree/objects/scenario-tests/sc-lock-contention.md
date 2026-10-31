---
id: sc-lock-contention
name: separate instances contend without blocking the event loop and recover after timeout
title: Lock Contention Recovered
description: Shows that two instances contend on one lock file and recover after the timeout.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-serialized-cross-process-writes
    - acceptance-lock-timeout-and-cancellation
  commitsTo:
    - sqlite-process-lock
---
## Test
separate instances contend without blocking the event loop and recover after timeout
## File
test/process-lock.test.ts
## What it proves
Shows that two instances contend on one lock file and recover after the timeout.
## Criteria
lock-serializes-two-instances, lock-times-out-with-lock-timeout