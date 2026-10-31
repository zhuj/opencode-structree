---
id: serialized-cross-process-writes
name: lock serialize
title: Serialized Cross Process Writes
description: Lets exactly one framework instance hold the source coordination lock at a time and releases it after a failed callback.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - process-coordination-lock
---
## Context
Lets exactly one framework instance hold the source coordination lock at a time and releases it after a failed callback.

## Expected behaviour
Two instances on one root take turns holding the coordination lock.

## Failure modes
A callback that throws rolls back the transaction and releases the lock.

## Covered by
lock-serializes-two-instances, lock-releases-after-callback-failure