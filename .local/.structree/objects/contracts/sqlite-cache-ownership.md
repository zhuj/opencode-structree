---
id: sqlite-cache-ownership
name: SQLite Cache Ownership
title: SQLite Cache Ownership
description: A foreign or unsupported database file is refused untouched.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-database-table-abstractions
    - adr-conservative-compatibility-guards
    - adr-revision-identity-follows-source-collation
---
## Rule
A cache file that is nonempty and unclaimed, that carries a foreign application_id, or that records an unsupported schema version MUST be rejected without changing its data or schema.
## Evidence
src/lib/sqlite/cache-database.ts:251-291
## Why it matters
Claiming a foreign file would corrupt an unrelated database and hide the mismatch.