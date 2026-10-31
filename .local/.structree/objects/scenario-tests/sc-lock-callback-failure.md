---
id: sc-lock-callback-failure
name: one instance serializes its callers and releases the transaction after callback failure
title: Lock Released After Failure
description: Shows that a failing callback rolls back and releases the transaction.
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
  commitsTo:
    - sqlite-process-lock
---
## Test
one instance serializes its callers and releases the transaction after callback failure
## File
test/process-lock.test.ts
## What it proves
Shows that a failing callback rolls back and releases the transaction.
## Criteria
lock-releases-after-callback-failure