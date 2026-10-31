---
id: lock-timeout-and-cancellation
name: lock timeout
title: Lock Timeout And Cancellation
description: Reports a lock timeout when the wait budget elapses and cancels a queued waiter without running its callback.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - serialized-cross-process-writes
  commitment:
    features:
      - process-coordination-lock
---
## Context
Reports a lock timeout when the wait budget elapses and cancels a queued waiter without running its callback.

## Expected behaviour
A waiter acquires the lock as soon as the holder releases it.

## Failure modes
The wait ends with LOCK_TIMEOUT or an abort when the budget is exhausted or cancelled.

## Covered by
lock-times-out-with-lock-timeout, lock-cancels-queued-waiter