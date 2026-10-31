---
id: concurrent-writes-serialized
name: Concurrent Writes Are Serialized
title: Concurrent Writes Are Serialized
description: Two writers cannot consume the same revision of a file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
Source mutations MUST be serialized by an in-process permit and a shared SQLite coordination lock, and two concurrent writers MUST NOT both be able to consume the same expected checksum.
## Evidence
src/lib/framework.ts:174-181; src/lib/filesystem.ts:222-227; src/lib/sqlite/process-lock.ts:158-172; test/framework.test.ts:178
## Why it matters
Without a shared lock two instances could both write the same revision and one would be lost.