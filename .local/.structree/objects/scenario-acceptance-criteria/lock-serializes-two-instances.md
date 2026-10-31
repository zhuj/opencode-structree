---
id: lock-serializes-two-instances
name: lock serializes two instances
title: Serialize concurrent instances
description: Two lock instances on one file let exactly one hold the transaction while the other waits without blocking the event loop.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: serialized-cross-process-writes
  dependsOn: []
---
## Statement
Serialize concurrent instances: Two lock instances on one file let exactly one hold the transaction while the other waits without blocking the event loop.
## How it is observed
Only one callback is inside the critical section at a time and the second completes after the first releases.