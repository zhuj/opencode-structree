---
id: database-test
name: database.test.ts
title: Database Test
description: Validates column codecs, filters, additive migrations and prepared revision bookkeeping on SQLite.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo: []
  commitsTo:
    - sqlite-metadata-row
    - cache-state-row
    - sync-issue
---
## File
test/database.test.ts
## What it covers
Effect column codecs preserve Dates; booleans; optional keys and supplied IDs | null converter output is not undone by serialization | bound filters handle null; empty membership; qualified columns; and offset without limit | composite primary keys work without inventing an id column; with source-row delete counts | additive migrations preserve extra columns and reject incompatible schemas atomically | migrations refuse a pre-existing UNIQUE constraint with a non-default conflict policy | migrations refuse a requested UNIQUE constraint with a non-default conflict policy | migrations refuse a UNIQUE conflict policy that a SQL comment hides | SQL comments do not change the compared table shape | an unterminated SQL comment is refused as a migration error | migrations accept an identical generated column expression and refuse a changed one | initialization rolls back all registered DDL and closes on failure | migration validation distinguishes partial uniqueness; collation; and primary-key configuration | persistent prepared revisions detect external writes; delete/recreate ABA; and key moves | prepared commits are single-use; throwing hooks roll back rows and revisions before retry | REGEXP capability is available only when the driver supports function registration | standalone converters fail on malformed stored values
## Verifies
cache-ownership-and-schema-version
## Exercises
sqlite-metadata-row, cache-state-row, sync-issue