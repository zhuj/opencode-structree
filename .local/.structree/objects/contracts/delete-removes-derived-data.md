---
id: delete-removes-derived-data
name: Delete Removes Derived Data
title: Delete Removes Derived Data
description: Deleting an object removes its search data together with its file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - checksum-guarded-writes
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
Delete MUST remove the source file and MUST remove the object's metadata, full-text and embedding rows, and it MUST accept only the current checksum.
## Evidence
src/lib/framework.ts:263-285; src/lib/sqlite/cache-database.ts:101
## Why it matters
A deleted object must disappear from search instead of lingering as a stale hit.