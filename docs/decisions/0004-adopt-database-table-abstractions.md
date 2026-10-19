---
status: accepted
date: "2026-10-19"
decision-makers: ["User"]
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0004. Adopt the supplied database and table abstractions with Effect codecs

## Decision summary

Use the supplied `Database`, `Table`, `IndexedTable`, index, converter, filter,
migration, and prepared-mutation structure as the framework's reusable SQLite
layer. Adapt its schema helpers to Effect and its keys and lifecycle to the
existing cache. This captures the user's explicit instruction on 2026-10-19 to
adopt the linked files as the database/table abstraction. Acceptance applies to
this adoption; it does not change the status of the earlier decision records.

## Context and problem statement

The first implementation used one `SqliteIndex` class for table DDL, CRUD,
metadata counters, FTS queries, and vector queries. The user subsequently supplied
twelve TypeScript modules expressing a reusable database/table structure and
requested their adoption together with Biome and code formatting.

The supplied modules target better-sqlite3, use Zod schema inspection, assume an
`id` key, create a vec0 table for vectors, and contain asynchronous table/index
methods. The existing framework uses Effect, supports two SQLite drivers, stores
document keys and composite chunk keys, and deliberately separates asynchronous
provider calls from synchronous cache transactions. Its cache is derived from
authoritative Markdown sources and can be shared by concurrent instances.

The decision concerns how to reuse the supplied structure while keeping those
existing contracts. Domain relationships, source-file semantics, model selection,
search ranking policy, and MCP tool names are outside its scope.

## Decision drivers

- The user explicitly requests the supplied database/table abstraction.
- Effect remains the only application schema system.
- The framework must actually use the new classes for its cache and retrieval.
- Existing v2 metadata and embeddings should remain reusable.
- SQL transactions must remain synchronous; slow preparation must not hold a
  cache write lock or overwrite a newer source revision.
- A schema helper must not silently discard columns, invent source data, or
  accept an incompatible layout.
- Additional plugin caches need a documented, typechecked extension API.

## Considered options

1. **Keep the consolidated SQL implementation and extract narrow helpers.** This
   could preserve the existing behavior with less generic API surface. It would
   leave most table lifecycle and CRUD logic specific to `SqliteIndex` and would
   not fulfill the requested adoption of a reusable database/table abstraction.
2. **Adapt the supplied structure and make the cache consume it**, selected. This
   exposes reusable table, index, and preparation APIs, while preserving the
   framework's existing storage contract. It adds a maintained abstraction layer
   and requires explicit compatibility and concurrency tests.

Copying the supplied modules without adaptation is not viable: their Zod
inspection, implicit destructive migrations, single-key table assumption, and
vector layout would conflict with the earlier requirements or existing cache.

## Decision outcome

`CacheDatabase` extends `Database` and registers concrete metadata, embedding,
generation, and issue tables. Metadata extends `IndexedTable`; the other tables
extend `Table` with their actual scalar or composite keys. `SqliteIndex` retains
the facade-facing cache API and response/rank-fusion logic. It delegates CRUD,
FTS retrieval, and vector retrieval to the adopted abstractions.

Effect's public canonical JSON codec APIs provide column conversion in both
directions. SQL column descriptors remain available for internal constraints and
layouts that must match an existing database exactly. `@local/object-mcp/sqlite`
exports the reusable layer, and a compiled example demonstrates its use in an
auxiliary plugin cache.

Table CRUD and index publication are synchronous. Prepared indexed mutations
snapshot a persistent row revision, finish embedding work outside the write
transaction, then check that revision inside `BEGIN IMMEDIATE`. Persistent
revision tombstones detect equal-valued writes and delete/recreate cycles.
Cancellation before commit prevents publication. Successful commits are single
use; a rolled-back commit can retry while its revision is current. The main
filesystem cache also retains its independent source-checksum publication guard.

The cache keeps its v2 ordinary-table embedding layout and exact filtered cosine
ranking described by [ADR 0002](0002-sqlite-search.md). FTS receives unmodified
text; literal escaping applies only to the query. Startup repairs missing,
duplicate, and orphan FTS identities. An incompatible FTS configuration requires
an explicit rebuild instead of being silently ignored.

Schema synchronization is additive. It creates tables, permits compatible
column additions, retains extra columns, and rejects mismatched constraints and
table properties. Cache ownership and version checks precede initialization.
Unknown or unsupported databases retain their data for an explicit migration or
selection of a new cache path.

## Consequences

### Positive

- New plugin caches can reuse typed CRUD, Effect converters, filters, FTS,
  vectors, and deferred mutations.
- The application cache uses the same layer exercised by the generic tests.
- Existing metadata, vector rows, and generation counters survive the refactor.
- Transaction boundaries and concurrency checks are explicit in the API.
- Migration failures are visible and preserve information needed for recovery.

### Negative

- There are more classes and public contracts to maintain than in the original
  consolidated implementation. Internal tables still contain purpose-specific
  SQL where a generic CRUD operation would obscure their behavior.
- The synchronous CRUD return types differ from the supplied asynchronous API.
  Provider preparation uses explicit async `prepare*` methods instead.
- Schema comparison is conservative. Semantically equivalent SQL expressions
  can still require an explicit migration when their declarations differ.
- Revision tombstones consume cache space over time. Dropping them while
  preparations are active would weaken conflict detection; reclamation requires
  a coordinated cache rebuild or a separately designed migration.
- Native driver capabilities differ. JavaScript REGEXP registration is available
  through better-sqlite3; it is not required by the framework's object searches.

Raw SQL remains an explicit escape hatch. Its callers own manually maintained
index consistency. Prepared revisions detect source writes, but SQL triggers
cannot run an asynchronous embedding provider. These limits and provider
ownership are documented in [the database guide](../database.md).

## Confirmation

The native suites exercise both better-sqlite3 and Bun SQLite. An independent
fixture of the original v2 schema verifies reopening, preserved vectors and
generation, search results, FTS repair, deletion, and a second reopen. Other
tests cover checksum guards, distinct-object ranking, converters, composite
keys, additive/incompatible migrations, partial unique indexes, key moves,
cross-connection revision conflicts, failed-hook rollback/retry, and cancellation
between preparation and commit. Generic indexes also test their default names,
configuration validation, and direct deferred-vector publication.

Reproduce with:

```sh
bun run check
python3 scripts/smoke-stdio.py
```

[Validation evidence](../validation.md) records the executed checks and their
limits. Revisit the abstraction when a new backend is required, migrations need
backfills or rebuilds, revision growth is material, or profiling shows synchronous
index operations exceed the plugin's latency needs. Those changes need their own
concrete workload and migration evidence.

## Links

- [Database and table guide](../database.md).
- [Concrete cache database](../../src/lib/sqlite/cache-database.ts).
- [Public SQLite API](../../src/lib/sqlite/public.ts).
- [Typechecked plugin-cache example](../../examples/database.ts).
- [Database tests](../../test/database.test.ts).
- [Search abstraction tests](../../test/search-abstraction.test.ts).
- [Previous-cache compatibility tests](../../test/cache-abstraction.test.ts).
- [Original cache schema fixture](../../test/fixtures/cache-v2.sql).
- [Filesystem commit and reconciliation](0001-filesystem-commit-and-reconciliation.md).
