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
const key = "project:structree-initial";
embeddingTable.read([key, 0]);
embeddingTable.read({ object_key: key, chunk_index: 0 });
```

`IndexedTable` requires one string document key. The object cache joins the type
and id with a colon, for example `project:structree-initial`. The type must not
contain a colon: registered type names are snake_case and never contain one,
while a caller of the public `objectKey` function gets a `TypeError` for a type
containing a colon.

The id part is used verbatim unless it contains a colon, a double quote, a
backslash, a control character (U+0000 to U+001F), or an unpaired UTF-16 surrogate.
In those cases the id part is `JSON.stringify(id)`. A plain id part never contains
a quote, so a JSON-encoded id part is recognizable by its leading double quote;
the pair is recoverable by splitting on the first colon. The framework never
decodes the key: the type comes from `object_type` and the exact id from `json`.
SQLite's UTF-8 TEXT binding normalizes an unpaired surrogate to U+FFFD, while
the JSON column preserves it. Chunk storage remains a separate composite-key
table. See [decision 0012](decisions/0012-use-a-type-id-cache-key.md).

This cache-key encoding is unchanged by the file naming contract. The object
framework lowercases object and relation ids at the start of create, get, update
and delete. A caller may send an id in any case; its lowercased form is checked
against the [portable stored-id domain](core-schemas.md#shared-fields), which
excludes separators, control characters and unpaired surrogates. Created files use
`<type directory>/<id>.md`, not the cache key. Reconciliation corrects a differing
base name in the file's existing directory and updates the indexed path. A
filesystem that folds case or normalizes names may spell the name differently
while the target still names the same file. That spelling is accepted: the file
stays unchanged and indexed at its actual path, with no issue reported. Only a
different file holding the target name is a conflict: both files remain unchanged
and the object is excluded with `RENAME_CONFLICT`. Nothing is overwritten.
Resync can rename files as well as update derived state. See
[decision 0013](decisions/0013-name-the-file-after-the-id.md).

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

## Literal queries in the object index

The object index retains `unicode61 remove_diacritics 2`; no tokenizer or ranking
change accompanies this guidance. The advertised query description is:

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

The type-filter description is:

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

`literalFtsQuery` extracts runs matching `[\p{L}\p{N}\p{M}]+`, deduplicates
identical strings before folding, quotes each token and joins them with `AND`.
Two words can occur anywhere, not necessarily together. `reconcil*` encodes as
`"reconcil"`, not a prefix. Case variants can occupy separate token slots before
SQLite folds them; repeated identical strings do not. Overflow throws and the
framework maps it to `INTERNAL`, not `VALIDATION`. Blank queries are separately
rejected by the framework. No extracted tokens means no lexical candidates,
not suppression of semantic evaluation in hybrid mode. `cafe` matches `café`;
literal matching is not byte-exact substring matching. Both drivers exercise
these guarantees in `test/sqlite.test.ts`.

The 128-distinct-token cap is a self-imposed bound on the generated FTS5 MATCH
expression, not a SQLite limit. It fails rather than truncates; callers shorten
their own over-limit queries. On 2026-10-21 SQLite 3.53.4 executed 2000 AND-joined
and 5000 OR-joined terms without error. See
[decision 0011](decisions/0011-publish-the-observed-surface-and-reject-empty-identifiers.md).
With no lexical tokens, hybrid still runs semantic ranking; those hits have
`fulltextRank: null` and a set `semanticDistance`, with no lexical evidence.
Retired objects remain listed and searchable; callers check `retiredAt` to
exclude them. This describes existing behavior, not a retrieval change.

## Search result shapes

`FTSIndex` and `VectorIndex` keep the source row and the ranking metadata in
separate namespaces. A search result is an object whose `row` property holds
the materialized source row; the ranking and chunk metadata are siblings of
that property, never fields merged into the row. A source column may legally
be named `lexical_score`, `distance`, `chunk_index`, `start_offset`,
`end_offset`, or `chunk_text`, and the ranking neither overwrites nor
shadows it.

| Call | Result element |
| --- | --- |
| `FTSIndex.searchRows(query, filter?, limit?)` | `{ row: Row; lexical_score: number }` |
| `FTSIndex.searchRowsWithExcerpt(query, filter?, limit?)` | `FTSExcerptRow<Row>`: `{ row: Row; lexical_score: number; excerpt: string }` |
| `FTSIndex.search(query, filter?, limit?)` | `{ id: string; rank: number }` |
| `VectorIndex.searchRows(vector, options?)` | `{ row: Row; distance: number; chunk_index: number; start_offset: number; end_offset: number; chunk_text: string }` |
| `VectorIndex.searchIdByEmbedding(vector, filter?, limit?)` | `{ row: { id: string }; distance: number }` |

`FTSResult.rank` is the same raw BM25 score that `FTSRow.lexical_score`
reports, and `VectorSearchResult.distance` is the same cosine distance that
`VectorSearchRow.distance` reports. A BM25 score is a raw value in which
smaller numbers rank first; it is not an ordinal rank. A vector distance is
the cosine distance clamped to the range 0 to 2, so smaller is closer.

`searchRowsWithExcerpt` shares the validated MATCH, bound filters, weighted BM25,
source projection, ordering and limit with `searchRows`. The same statement adds
`snippet(<quoted FTS table>, -1, '', '', '...', 32)`. Automatic column selection
can choose name, title or raw text; it is not attribution to the largest BM25
contribution. The fixed 32-token extraction budget is not a character or model-token
limit. The reserved `fts excerpt` alias, like `fts lexical score`, is outside
the declared source-column namespace; a source `excerpt` or retained extra alias
cannot shadow it. Table identifiers are quoted and query/filter values stay bound.
Existing `search` and `searchRows` shapes are unchanged.

The concrete object index publishes this evidence as `fulltextExcerpt`, capped
after extraction to the first `search.maxMatchCharacters` Unicode code points
(1200 by default), including native `...` markers without splitting surrogate pairs.
Every concrete hit has a string when it has a lexical match, even with zero lexical
fusion weight, and null otherwise, including semantic-only hybrid candidates.
The public field is optional for older/custom producers; absence means no excerpt
was supplied. It carries no coordinates or column provenance and does not replace
the unchanged semantic `matchedChunk`. One excerpt need not show every AND term;
a small cap or long token can hide the visible match. Markup remains text, not
HTML-sanitized output. The whole hit is discarded on checksum rejection without
refill or an extra per-hit read. The `body` field remains opt-in.

`fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

```ts
import type { FTSRow, VectorSearchRow } from "@local/object-mcp/sqlite";

// Note stands for the source row type of the indexed table.
const lexical: FTSRow<Note>[] = ftsIndex.searchRows("orchard", undefined, 10);
for (const match of lexical) {
  match.row.title; // the source row keeps its own columns
  match.lexical_score; // raw BM25 score; smaller ranks first
}

const semantic: VectorSearchRow<Note>[] = vectorIndex.searchRows(queryVector, { limit: 5 });
for (const match of semantic) {
  match.row.title; // the source row keeps its own columns
  match.distance; // cosine distance; smaller is closer
  match.chunk_index; // index of the matching chunk
  match.start_offset; // chunk start offset in the source text
  match.end_offset; // chunk end offset in the source text
  match.chunk_text; // the matched chunk text
}
```

### Upgrading from the flat result shape

The earlier flat shape is gone. It merged the source row and the ranking
metadata into a single object:

```ts
// before
type FTSRow<Row extends object> = Row & { readonly lexical_score: number };
type VectorSearchRow<Row extends object> = Row & {
  readonly distance: number;
  readonly chunk_index: number;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly chunk_text: string;
};
```

That shape spread the source row's own columns across the same object as the
ranking, so a source column named like a ranking field could be overwritten
by it, and the ranking could be shadowed by it. After upgrading, read the
source row from `match.row` and the metadata from its siblings.

### Write metadata and the effective fingerprint

`VectorIndex.metadataForRow(row)` returns the `VectorWriteMetadata` that
`insertRow` and the prepared mutations publish with a write:
`{ checksum, fingerprint }`. The checksum is the SHA-256 of the extracted
text when no `freshness` columns are configured, and otherwise the source
row's `freshness.checksum` value.

Two fingerprints are involved, and they are not interchangeable:

- The **provider fingerprint** is the upstream model identifier:
  `EmbeddingProvider.fingerprint`, or the `fingerprint` option of
  `VectorIndexOptions` when it overrides the provider.
- The **effective fingerprint** is the value `VectorIndex` actually stores and
  filters on. It is a SHA-256 over the version marker
  `object-mcp/indexed-table-embeddings/v1`, the provider fingerprint, the
  embedding dimensions, and the chunk options, so a different model,
  dimension, or chunking yields a different effective fingerprint.

The effective fingerprint is written to the `fingerprint` column of the
vector rows, is returned by `metadataForRow`, is published to the configured
`freshness.fingerprint` source column, and is the value that
`VectorIndex.searchRows` matches with `v.fingerprint = ?`. A search uses
that same effective fingerprint when `VectorSearchOptions.fingerprint` is
omitted. Pass the option only to search rows written with exactly that
value: a provider fingerprint on its own does not match the rows written
through the ordinary path, because those rows carry the effective
fingerprint.

```ts
const metadata = vectorIndex.metadataForRow(row);
metadata.checksum; // freshness checksum written with the vectors
metadata.fingerprint; // effective fingerprint: stored and filtered on
```

## Migration and compatibility

The cache uses schema version **3** for the new type-and-id key encoding. The
derived cache is rebuildable: replace the existing version-2 cache file rather
than migrate it. The next sync rebuilds the index and re-embeds the corpus when
embeddings are enabled. A stale cache file is refused with the message
"use a fresh cache file and resync the Markdown sources". Startup FTS repair
covers missing, duplicate, and orphan identities. A changed FTS layout or
tokenizer requires an explicit rebuild; initialization reports incompatible
configuration instead of silently using an old layout.

The FTS compatibility check compares the declared columns, the tokenizer, and the
content model. A pre-existing index that stores its content in another table
(`content='other'`), stores no content of its own (`content=''`), or has had an
indexed field changed to `UNINDEXED` is a different layout, so initialization
refuses it and requires an explicit rebuild. Without that check the index would
appear to initialize successfully and then fail at query time, or return empty
results, depending on the variant.

`Migrator.sync` creates a missing table and can add compatible nullable/defaulted
columns. It refuses incompatible primary keys, types, nullability, defaults,
constraints, collations, or table options. It does not drop extra columns or
invent backfill values. An explicit application migration decides how to handle
such changes. The object cache also refuses unrelated nonempty databases and
unsupported cache versions before claiming ownership.

The version-2 to version-3 change does not use `Migrator.sync`: its additive
rules refuse a changed primary key. See
[decision 0012](decisions/0012-use-a-type-id-cache-key.md) for the replacement
policy and key-encoding trade-offs.

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
