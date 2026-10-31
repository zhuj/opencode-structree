---
id: adr-database-table-abstractions
name: Database table abstractions
title: Database Table Abstractions
description: The supplied Database, Table, IndexedTable, index, converter, filter, migration and prepared-mutation structure is adopted as the framework's reusable SQLite layer, adapted to Effect and to the existing cache contract.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - cache-ownership-and-schema-version
      - resync-index-reconciliation
  partOf: null
  dependsOn: []
---
## Context
The first implementation used one `SqliteIndex` class for table DDL, CRUD, metadata counters, FTS queries and vector queries, and on 2026-10-19 the user supplied twelve TypeScript modules expressing a reusable database and table structure and asked for their adoption. Those modules target better-sqlite3, use Zod schema inspection, assume an `id` key, create a vec0 table for vectors and expose asynchronous methods, which conflicts with the framework's Effect schemas, two SQLite drivers, composite chunk keys and synchronous cache transactions. The question was how to reuse the supplied structure without breaking the existing storage contract.

## Decision
The framework adopts the supplied `Database`, `Table`, `IndexedTable`, index, converter, filter, migration and prepared-mutation structure as its reusable SQLite layer: `CacheDatabase` extends `Database` and registers the concrete metadata, embedding, generation and issue tables, while `SqliteIndex` keeps the facade-facing cache API and delegates CRUD, FTS and vector retrieval to those abstractions. The adoption was requested by the user on 2026-10-19 and is recorded as accepted, without changing the status of the earlier decision records.

## Consequences
- New plugin caches can reuse typed CRUD, Effect converters, filters, FTS, vectors and deferred mutations, and the application cache now runs on the same layer exercised by the generic tests.
- There are more classes and public contracts to maintain, and the synchronous CRUD return types differ from the supplied asynchronous API, so provider preparation uses explicit async `prepare*` methods.
- Schema synchronization stays conservative and additive: compatible column additions are permitted, but mismatched constraints, table properties or an incompatible FTS configuration require an explicit rebuild.
- Revision tombstones consume cache space over time, and dropping them while preparations are active would weaken conflict detection.

## Evidence
- `docs/decisions/0004-adopt-database-table-abstractions.md` (status accepted, decision-maker "User", dated 2026-10-19)
- `src/lib/sqlite/cache-database.ts`, `src/lib/sqlite/public.ts` and `examples/database.ts`
- `test/database.test.ts`, `test/search-abstraction.test.ts`, `test/cache-abstraction.test.ts` and `test/fixtures/cache-v2.sql`