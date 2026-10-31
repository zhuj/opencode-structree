---
id: sc-lock-cancellation
name: queued and SQLite-busy cancellation reject promptly without invoking either callback
title: Queued Cancellation Prompt
description: Shows that an aborted waiter rejects promptly and never runs its callback.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-lock-timeout-and-cancellation
  commitsTo:
    - sqlite-process-lock
---
## Test
queued and SQLite-busy cancellation reject promptly without invoking either callback
## File
test/process-lock.test.ts
## What it proves
Shows that an aborted waiter rejects promptly and never runs its callback.
## Criteria
lock-cancels-queued-waiter