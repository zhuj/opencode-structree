---
status: proposed
date: "2026-10-18"
decision-makers: []
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0002. Keep vector rows in ordinary SQLite tables and rank eligible objects exactly

## Decision summary

Use ordinary SQLite tables for metadata and float32 embedding BLOBs, the native
`sqlite-vec` cosine-distance function for semantic ranking, and FTS5 for lexical
ranking. Apply type and embedding-freshness restrictions before ranking; select
each object's best chunk before limiting the number of objects. This makes the
requested search semantics directly inspectable in SQL and preserves one
transaction boundary for all derived state. The accepted cost is a scan of every
eligible vector for each semantic query.

This choice is implemented and remains **proposed** for the user's architectural
review. No maintainer approval or production performance target has been recorded.

## Context and problem statement

The user requested a filesystem-authoritative registry of Markdown objects, a
rebuildable SQLite metadata and embedding cache, and top-N full-text, semantic,
or combined search across an optional subset of registered object types. Each
object has one whole-file vector at chunk index zero and additional part vectors.

How should the derived index provide the best matching **objects**, including
selective searches, while the model, dimensions, source checksums, and chunking
configuration can change?

**In scope:** vector storage, search ranking, freshness checks, and transactional
maintenance of the derived index. **Out of scope:** source-file mutation policy,
embedding model selection, and changes to the public Effect object schemas.

## Decision drivers

### Hard constraints

- Markdown files remain authoritative. Every SQLite table must be recoverable
  from those files and the selected embedding provider.
- Search accepts a subset of registered types. An empty subset produces no
  matches; excluded types must not consume a result limit.
- Results contain distinct objects. One object with many nearby chunks must not
  crowd other objects out of a top-N response.
- A vector is eligible only for its current file checksum and the supplied active
  model/chunk fingerprint and dimensions.
- Full-text indexing can proceed while semantic indexing is unavailable.

### Evaluation criteria

- Auditable query and update semantics with the pinned native dependencies.
- Straightforward handling of model and dimension changes.
- Small operational footprint for a local plugin.
- A migration path if measured corpus size or latency requires faster search.

## Considered options

1. **Ordinary embedding rows with scalar sqlite-vec distance queries**, selected.
2. **A vec0 virtual table with metadata or partition filters**, retained as the
   next option to evaluate if measurements justify a different layout.

Both approaches are supported by the upstream
[sqlite-vec KNN documentation](https://alexgarcia.xyz/sqlite-vec/features/knn.html).
The second option can satisfy type filtering; the choice does not depend on a
claim that `vec0` lacks that capability.

## Decision outcome

Store metadata in `object_meta` and vectors in `embeddings`. The logical object
identity is `(type, id)`, represented by `JSON.stringify([type, id])`; embedding
rows have primary key `(object_key, chunk_index)`. Each row also stores its source
checksum, fingerprint, dimensions, source offsets, and text. BLOB length is
checked against `dimensions * 4`; the TypeScript boundary validates finite,
nonzero vectors and a consistent dimension within each object.

The primary identity uses JSON escaping so distinct JavaScript string IDs remain
distinct even when they contain lone UTF-16 surrogates. Public metadata and
search labels use the canonical JSON payload and object key; SQLite TEXT columns
are searchable projections and may normalize those invalid Unicode sequences.
They do not impose a second uniqueness constraint. This initial implementation
uses cache schema version 2; an earlier development cache must be recreated.

Semantic SQL first restricts object types and fresh embedding spaces. It then
calculates cosine distances and uses a window rank to retain the best chunk per
object. Only after this step does it apply the document limit. Equal distances
prefer the smaller chunk index; equal document scores use deterministic type/ID
ordering. Returned chunk text is an excerpt capped by
`search.maxMatchCharacters`, with codepoint offsets describing the actual excerpt.

FTS5 indexes object names, titles, and complete Markdown text. User query text is
converted to quoted Unicode tokens joined with `AND`; the API does not expose
raw FTS syntax. This is an application choice built on the
[FTS5 tokenizer, quoted-string, and BM25 interfaces](https://www.sqlite.org/fts5.html).

Hybrid search combines document-level ranks using configurable weighted
reciprocal rank fusion. Each input ranking supplies up to
`topN * candidateMultiplier` objects. The cosine distances and semantic ranking
within the selected population are exact; **hybrid fusion is limited to these
candidate pools**, and does not claim the globally highest RRF score over every
possible document.

Metadata changes and stale-vector deletion share a synchronous SQLite
transaction. New vectors are published in another transaction only if the source
checksum still matches. Filesystem work and provider calls happen outside these
transactions. A read transaction gives each search one consistent metadata,
ranking, and generation snapshot. The surrounding framework also rechecks
candidate file checksums before returning hits.

### Consequences

#### Positive

- All eligible chunks are considered before document grouping and limiting.
- A dimension change can coexist temporarily with old cached rows; explicit
  freshness restrictions prevent incompatible spaces from being compared.
- Full-text state, vector invalidation, deletion, generation counters, and sync
  issues use ordinary transactional SQL.
- The index remains replaceable. Migrating to another vector layout does not
  require modifying authoritative Markdown files or domain schemas.

#### Negative

- Semantic distance work grows with eligible vector count times dimensions;
  joins and sorting add further cost. Queries use the synchronous SQLite API and
  can delay other work in the process when the corpus is large.
- The cache duplicates source text in metadata, FTS, and chunk rows. This favors
  simple recovery and query behavior over minimum disk usage.
- Candidate-limited hybrid ranking can omit an object whose moderate rank in
  both channels would give it a strong global RRF score. Increasing
  `candidateMultiplier` trades more query work for broader fusion coverage.
- No throughput, latency, or corpus-size guarantee is established by the
  correctness tests below.

#### Risks and mitigations

| Risk | Assessment | Mitigation or exit strategy | Owner |
| --- | --- | --- | --- |
| Synchronous vector scans become too slow | Depends on real corpus size and hardware; not measured | Benchmark representative vector counts and dimensions; evaluate a `vec0` layout or worker isolation | Project maintainer, not yet assigned |
| Stale vectors describe changed files | Covered by checksum invalidation and stale-publication tests | Publish metadata/invalidation atomically; verify current checksum before vector replacement and before returning a hit | Framework implementation |
| Model changes make old vectors appear ready | Covered by fingerprint and dimension tests | Pass the active fingerprint to search and status; distinguish active embedded objects from cached embedded objects | Framework implementation |
| Native package availability differs by platform | Linux x64 is verified; other target platforms need verification | Keep both configured drivers and an explicit extension-path override; run the same native tests on each shipping target | Project maintainer, not yet assigned |

### Confirmation

On **2026-10-18**, the committed test source in
[test/sqlite.test.ts](../../test/sqlite.test.ts) ran successfully using **Bun
1.4.3**, **better-sqlite3 13.0.3**, and **sqlite-vec 0.1.9** on Linux x64. The
native SQLite engine reported **3.53.4**. The suite ran against both the
`better-sqlite3` and `bun:sqlite` adapters: **22 tests passed, with 176 assertions**.
The database integration cases use real SQLite, FTS5, and the loaded vector
extension; their supplied vectors are controlled ranking fixtures, not a test of
embedding-model quality. The separate custom-library selection guard test uses
an injected setter; native custom SQLite loading on macOS has not been verified.

Coverage includes Unicode/literal full-text queries, type filtering before
semantic limits, chunk-to-object grouping, weighted fusion, stale-checksum
rejection across two connections, incompatible fingerprints and dimensions,
active-space status, invalid-vector rollback, excerpt offsets, renames,
deletions, exact string identities and labels containing lone surrogates, and
persistent state after reopening the database. The SQLite module
and its tests also passed strict TypeScript checking with exact optional
properties and unchecked-index checks enabled.

One compatibility discrepancy was exercised and fixed: Bun's `run().changes`
included FTS trigger and cascade writes in deletion counts. Object deletion uses
`DELETE ... RETURNING object_key` to count objects consistently across adapters.

Run the evidence suite with:

```sh
bun test test/sqlite.test.ts
bun run typecheck
```

Revisit this decision when a representative workload misses the project's
chosen latency target, when search requires richer filters or ranking, or before
adopting a new major SQLite/vector dependency. A production latency target and
representative corpus benchmark remain follow-up work; no arbitrary scale
threshold is asserted here.

## Option analysis

### Ordinary rows and scalar distance queries

The selected layout uses the upstream-supported regular-table approach with
`vec_distance_cosine`, relational filtering, and window functions. It makes
document grouping and model freshness visible in one SQL statement and permits
multiple recorded dimensions during a rebuild. The main costs are full scans,
sorting, and duplicated cache text. Its reversibility is high because all rows
are derived and the public search result shape is independent of the layout.

### vec0 virtual tables

A viable alternative stores vectors in a `vec0` table, with suitable metadata or
partition keys for type restrictions and a mapping to object/chunk identity.
The upstream [vec0 documentation](https://alexgarcia.xyz/sqlite-vec/features/vec0.html)
describes metadata predicates and partitioned KNN queries. Upstream also presents
`vec0` as a more compact, faster layout than manual regular-table KNN; this
project has not measured that comparison for its own workload.

To preserve this framework's result contract, that implementation must obtain
enough eligible chunks to find N distinct objects, handle arbitrary type
subsets, and invalidate or recreate dimension-specific vector layouts when the
model changes. A fixed small KNN chunk limit followed by object deduplication
would be insufficient. A correct implementation could use adaptive candidate
expansion or an alternative document-level query strategy, followed by the same
contract tests. These additional choices are deferred until a benchmark shows
that the current simpler layout needs replacement.

## Links

- Requirements and usage: [Project README](../../README.md).
- Implementation: [SQLite index](../../src/lib/sqlite/index.ts),
  [driver adapters](../../src/lib/sqlite/driver.ts), and
  [framework synchronization](../../src/lib/framework.ts).
- Reproducible dependencies: [package.json](../../package.json).
- Native evidence: [SQLite integration tests](../../test/sqlite.test.ts).
- Upstream references, inspected 2026-10-18:
  [sqlite-vec KNN](https://alexgarcia.xyz/sqlite-vec/features/knn.html),
  [vec0](https://alexgarcia.xyz/sqlite-vec/features/vec0.html), and
  [SQLite FTS5](https://www.sqlite.org/fts5.html). These documentation pages are
  rolling; implementation compatibility was verified against the pinned versions
  listed above.
- Approval: not yet recorded; the record remains proposed.
