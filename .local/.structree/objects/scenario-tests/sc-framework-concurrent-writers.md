---
id: sc-framework-concurrent-writers
name: two concurrent writers cannot both consume the same checksum
title: Concurrent Writers Serialize
description: Shows that two writers cannot both consume the same expected checksum.
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
two concurrent writers cannot both consume the same checksum
## File
test/framework.test.ts
## What it proves
Shows that two writers cannot both consume the same expected checksum.
## Criteria
lock-serializes-two-instances