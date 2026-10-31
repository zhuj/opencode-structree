---
id: sqlite-table-api
name: SQLite Table API
title: SQLite Table API
description: Exposes the driver, typed tables, index, migration and prepared-mutation abstractions for additional derived tables.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - sqlite-cache-ownership
  commitsTo:
    - adr-sqlite-search-index
    - adr-database-table-abstractions
---
## Surface
src/lib/sqlite/public.ts - Database, Table, IndexedTable, Migrator, FTSIndex, VectorIndex, Filter and the prepared mutations.
## Behavior
Exposes the driver, typed tables, index, migration and prepared-mutation abstractions for additional derived tables.
## Guarantees
- A table declares its columns and key, and a migration is explicit.
- Filters and prepared statements bind values instead of interpolating text.
- The abstractions never open or modify an object Markdown file.