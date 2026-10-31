---
id: lock-releases-after-callback-failure
name: lock releases after callback failure
title: Release after a failing callback
description: A callback that throws rolls back the transaction and leaves the lock available to the next caller.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: serialized-cross-process-writes
  dependsOn:
    - lock-serializes-two-instances
---
## Statement
Release after a failing callback: A callback that throws rolls back the transaction and leaves the lock available to the next caller.
## How it is observed
The transaction is rolled back and a subsequent run on the same lock succeeds.