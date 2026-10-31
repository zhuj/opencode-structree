---
id: cache-abstraction-test
name: cache-abstraction.test.ts
title: Cache Abstraction Test
description: Checks that a legacy cache is reopened, repaired and claimed, or refused, without losing data.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-cache-unclaimed
    - sc-cache-version
  commitsTo:
    - sqlite-metadata-row
    - cache-state-row
    - full-text-row
---
## File
test/cache-abstraction.test.ts
## What it covers
opens the original v2 schema; retains cached vectors; and repairs missing/duplicate FTS rows | refuses to claim an unrelated nonempty database without changing its data or schema | refuses to claim a database whose table name only resembles the reserved prefix | refuses a cache from an unsupported version without dropping fields
## Verifies
cache-ownership-and-schema-version, resync-index-reconciliation
## Exercises
sqlite-metadata-row, cache-state-row, full-text-row