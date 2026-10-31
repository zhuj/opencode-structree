---
id: sqlite-index-and-search
name: sqlite index
title: Sqlite Index And Search
description: Maintains a rebuildable SQLite cache of object metadata, the full-text index, embedded chunks, issues and a monotonic generation counter.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
## What it does
Maintains a rebuildable SQLite cache of object metadata, the full-text index, embedded chunks, issues and a monotonic generation counter.

## Where it lives
src/lib/sqlite/index.ts, src/lib/sqlite/cache-database.ts, src/lib/sqlite/database.ts, src/lib/sqlite/table.ts, src/lib/sqlite/index-table.ts, src/lib/sqlite/column.ts, src/lib/sqlite/migrator.ts

## Scenarios
full-text-bm25-ranking, cache-ownership-and-schema-version, resync-index-reconciliation

## Verification
test/sqlite.test.ts; test/cache-abstraction.test.ts; test/database.test.ts