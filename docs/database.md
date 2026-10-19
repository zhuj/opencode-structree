# Database and table abstractions

The framework adopts the supplied database module as its SQLite abstraction. The
implementation lives in `src/lib/sqlite/` and is exported as
`@local/object-mcp/sqlite`. Effect remains the schema system throughout the
package; the supplied Zod helpers became `columnsFromEffect`, `columnFromEffect`,
and `parseEffectType`.

## How the cache uses it

`SqliteIndex` implements the framework's cache operations and search response
contract. `CacheDatabase` owns its connection and registers the concrete tables.
SQL for each table or search index stays with that abstraction.

| Concrete table | Base abstraction | Responsibility |
| --- | --- | --- |
| `ObjectMetadataTable` | `IndexedTable<MetadataRow>` | Metadata CRUD, FTS maintenance, persistent mutation revisions, readiness counts. |
| `EmbeddingTable` | `Table<VectorRow>` | Embedding rows keyed by `(object_key, chunk_index)`, with source checksum, model fingerprint, dimensions, offsets, text, and float32 bytes. |
| `CacheStateTable` | `Table<StateRow>` | Persistent index generation. |
| `SyncIssuesTable` | `Table<SyncIssue>` | Reconciliation issues keyed by `(path, code)`. |

`FTSIndex` handles literal FTS5 queries and their source-table triggers.
`VectorIndex` handles validated chunk publication and exact sqlite-vec cosine
ranking. Both receive parameterized source-table filters. Semantic ranking
selects the best eligible chunk per object before applying the object limit;
the facade's weighted reciprocal rank fusion and result shape stay at
`SqliteIndex`.

The file store's separate coordination connection is a lock primitive. It uses
the shared driver adapter directly because it holds a SQLite lock across an
asynchronous filesystem critical section. Ordinary cache transactions contain
only synchronous SQL; embedding calls run outside them.

## Mapping from the supplied files

| Supplied module | Adopted behavior and adaptations |
| --- | --- |
| `database.ts` | Registered tables, extension loading, WAL/foreign-key setup, explicit initialization and shutdown; supports the configured native driver. |
| `table.ts` | Typed CRUD, converters, prepared statements, filters and ordering; configurable scalar or composite primary keys. |
| `column.ts` | Column descriptors and converters derived from Effect JSON codecs; no dependency on a missing logger or on Zod internals. |
| `filter.ts` | Bound parameters, validated identifiers, composition, JSON predicates, null handling, and empty-set handling. |
| `migrator.ts` | Creates or safely extends tables, validates incompatible layouts, and retains extra columns. Destructive changes require an explicit migration. |
| `index-table.ts` | `IndexedTable` combines CRUD, FTS, vector invalidation, and asynchronous preparation followed by a synchronous commit. |
| `fts-index.ts` | Original text storage, literal query encoding, source triggers, startup repair, weighted BM25, and explicit layout validation. |
| `vector-index.ts` | Whole-document/chunk embeddings in regular SQLite tables; configurable provider, freshness filters, and distinct-object cosine ranking. |
| `prepared-mutation.ts` | Persistent revision guards, delete/recreate detection, rollback, and a single-use successful commit. |
| `embeddings.ts` | Adapter from the framework's batched ONNX/OpenAI provider contract to the supplied single-text/batch index interface. |
| `regexp-function.ts` | Bounded regex cache and explicit driver capability; no external LRU dependency. |
| `errors.ts` | Database, migration, order, duplicate, index, and mutation-conflict errors. |

## A typed plugin cache

Use these classes for additional derived plugin tables. Keep authoritative
object-file operations in the object facade.

```ts
import { Schema } from "effect";
import {
  columnsFromEffect,
  Database,
  Filter,
  Table,
} from "@local/object-mcp/sqlite";

const CachedRecordSchema = Schema.Struct({
  id: Schema.String,
  summary: Schema.String,
  indexedAt: Schema.Date,
  labels: Schema.Array(Schema.String),
});
type CachedRecord = typeof CachedRecordSchema.Type;

class CachedRecords extends Table<CachedRecord> {
  readonly tableName = "cached_records";

  constructor(database: Database) {
    super(database, columnsFromEffect(CachedRecordSchema));
  }
}

class PluginDatabase extends Database {
  readonly records = this.register((database) => new CachedRecords(database));
}

const database = new PluginDatabase({
  driver: "better-sqlite3",
  path: "/my/workspace/.cache/plugin.sqlite",
  busyTimeoutMs: 5_000,
});
database.initialize();

database.records.upsert("source-object-1", {
  summary: "Filesystem reconciliation",
  indexedAt: new Date(),
  labels: ["filesystem"],
});

const rows = database.records.readAll(Filter.like("summary", "%reconciliation%"), {
  orderBy: "indexedAt DESC, id",
  limit: 10,
});
// rows contain Date values and string arrays after materialization.
database.close();
```

`examples/database.ts` is a typechecked example using `IndexedTable`, optional
provider injection, and prepared cache updates. `toIndexEmbeddingProvider`
preserves query/document purpose and cancellation. The host owns the underlying
provider's lifetime; closing this auxiliary database does not close a provider
shared with another component.

### CRUD and keys

`Table` exposes synchronous `create`, `read`, `readAll`, `update`, `upsert`, and
`delete` methods, with `*Sync` aliases for explicit transaction-oriented code.
`create` returns the materialized stored row, including database defaults.
`upsert` returns whether it inserted a row; `delete` returns whether it deleted
one source row. Trigger/cascade writes do not inflate this result.

With the default `id` primary key, an omitted ID is generated using
`crypto.randomUUID()`. Explicit IDs remain unchanged. Custom keys do not receive
an extra `id` column. Composite tables accept their key as an ordered array or a
keyed object:

```ts
// For a table configured with primaryKey: ["object_key", "chunk_index"]:
const key = JSON.stringify(["project", "project-1"]);
embeddingTable.read([key, 0]);
embeddingTable.read({ object_key: key, chunk_index: 0 });
```

`IndexedTable` requires one string document key. The object cache already uses
the lossless `JSON.stringify([type, id])` encoding. Its chunk storage remains a
separate composite-key table.

Effect codecs validate and convert values in both directions. Dates use ISO text,
booleans use `0`/`1`, and structured values use JSON text. Optional and nullable
fields retain their respective materialization behavior; an intentionally null
converter result is preserved. Because SQLite has one `NULL` value, a field
allowing both omission and null materializes a stored `NULL` as explicit null.
`Schema.Finite` and `Schema.Int` map to numeric storage; broader JSON
representations, including those of an unrestricted Effect number schema, use
text when required by the codec. A malformed stored value throws instead of
silently becoming an incorrectly typed row.

### Deferred mutations

For an indexed table with embeddings, use `prepareCreate`, `prepareUpdate`,
`prepareUpsert`, `prepareDelete`, or `prepareIndexRepair`:

```ts
const prepared = await database.notes.prepareUpdate(id, {
  title: "Updated title",
  text: "Updated source text",
});

prepared.commit((result) => {
  // Optional: synchronous SQL on this same database connection.
  // Throwing rolls back the source-row and index changes together.
});
```

Preparation takes a row/revision snapshot and computes embedding vectors without
holding the write transaction. Commit checks the persistent revision under
`BEGIN IMMEDIATE` and publishes the row and its indexes together. Updates from
another connection, equal-valued updates, and delete/recreate cycles all
invalidate an older preparation. Successful commits cannot be replayed. A
transaction that rolls back can be retried while its snapshot is still current.
Commit callbacks must be synchronous; promise-returning callbacks are rejected.
Cancellation is checked during preparation and again at commit, so aborting a
prepared operation before publication leaves its row and indexes unchanged.

Synchronous indexed CRUD maintains FTS and invalidates affected vectors. It does
not start background provider work. Prepared operations compute vectors for the
same atomic publication. The object framework additionally checks the current
filesystem checksum before publishing its deferred embeddings.

`raw` is an explicit SQL escape hatch. Raw source-table writes advance mutation
revisions and direct-column FTS triggers, but application code performing raw
writes must maintain any manually extracted FTS/vector indexes. Revision guards
protect prepared work; they do not run an embedding model from a SQL trigger.

## Migration and compatibility

The cache retains schema version **2** and its existing object/chunk identities.
Opening an earlier v2 cache adds the abstraction's revision/repair support without
discarding metadata or embeddings. Startup FTS repair covers missing, duplicate,
and orphan identities. A changed FTS layout or tokenizer requires an explicit
rebuild; initialization reports incompatible configuration instead of silently
using an old layout.

`Migrator.sync` creates a missing table and can add compatible nullable/defaulted
columns. It refuses incompatible primary keys, types, nullability, defaults,
constraints, collations, or table options. It does not drop extra columns or
invent backfill values. An explicit application migration decides how to handle
such changes. The object cache also refuses unrelated nonempty databases and
unsupported cache versions before claiming ownership.

The native integration suite loads an independent fixture of the previous
schema, including stored embeddings, before opening it through the new classes.
See `test/cache-abstraction.test.ts` and `test/fixtures/cache-v2.sql`.

## Filters and driver capabilities

Filter values are bound parameters. Identifier helpers accept validated SQL
names, including qualified names such as `m.object_type`; `Filter.raw` and column
SQL constraints are trusted application SQL, not MCP request inputs. Empty
membership filters match no rows. Null equality uses `IS NULL`, and offset-only
pagination emits SQLite's required unlimited `LIMIT` clause.

`Database` registers the supplied regex helper when the driver supports
JavaScript SQL functions. `regexpAvailable` reports that capability. Setting
`registerRegexp: true` requires it; `false` disables it. The tested
`better-sqlite3` driver supports registration, while Bun's driver does not expose
that API. Regex patterns are trusted application input; the small bounded cache
and common-pattern rejection are not a general regex sandbox. Object search uses
FTS5 and sqlite-vec and does not require REGEXP.

## Code formatting and checks

Biome **2.5.15** is pinned in both lockfiles. Its configuration uses two spaces,
double quotes, semicolons, trailing commas, LF, and a 100-column line width.
Recommended lint checks and import organization are enabled. Runtime object
directories, model/cache assets, dependencies, lockfiles, and generated output
are excluded from source formatting.

```sh
bun run format        # Apply formatting
bun run format:check  # Verify formatting
bun run lint          # Verify lint; warnings fail
bun run biome:fix     # Apply safe formatting, lint, and import fixes
bun run check         # Biome, strict TypeScript, then all ordinary tests
```

Tests permit non-null assertions for fixture values checked by their assertions.
Runtime exceptions are narrow and explained next to the relevant code: the
required arbitrary-metadata contract, heterogeneous Effect codec types, and a
dimension-validated typed-array access. The formatter configuration is shared by
the CLI and editor integrations. See the official
[Biome configuration reference](https://biomejs.dev/reference/configuration/) and
[CLI reference](https://biomejs.dev/reference/cli/).
