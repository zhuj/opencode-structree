---
id: lock-file-holds-no-object-data
name: Lock File Holds No Object Data
title: Lock File Holds No Object Data
description: The coordination database exists only to serialize writers.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - concurrent-writes-serialized
  commitsTo:
    - adr-local-state-layout
    - adr-filesystem-commit-and-reconciliation
---
## Rule
The coordination file MUST contain only an empty coordination table and MUST NOT contain any source object, and its name MUST be fixed under the source root so all instances share it.
## Evidence
src/lib/sqlite/process-lock.ts:76-82; src/lib/filesystem.ts:57-62; docs/configuration.md:20
## Why it matters
A shared file inside the source root could otherwise be mistaken for object data.