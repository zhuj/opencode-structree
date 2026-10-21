---
status: accepted
date: "2026-10-21"
decision-makers:
  - User
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0012. Use a type:id cache key

## Decision summary

Join the type and id with a colon, for example `project:structree-initial`.
JSON-encode the id part only when it needs escaping. Preserve the reusable
library's arbitrary-id guarantee, including unpaired UTF-16 surrogates. Bump the
derived cache schema from version 2 to 3 and replace the cache file rather than
migrate it.

## Context and problem statement

The cache key identifies an object in `object_meta`, is the foreign key of
`embeddings`, and joins the FTS5 table and vector query. It is also the document
key produced by the file scan. A change to its identity model reaches every
one of those layers.

The previous serialized-array encoding was lossless. The parent session's
measurement on 2026-10-21 established why that mattered: SQLite's UTF-8 TEXT
binding normalizes an unpaired UTF-16 surrogate to U+FFFD. Distinct ids
`"id\ud800tail"` and `"id\ufffdtail"` would collapse into one raw-id cache row
and fail the primary key. JSON stringification escapes the surrogate and keeps
the ids distinct.

The file-backed vault cannot hold such an id: `src/lib/vault/utf8.ts` refuses
text containing an unpaired surrogate with an `ENCODING` error. The guarantee
still matters for the publicly exported reusable library. Search-result labels
now come from the `json` column rather than the key, so the framework can treat
the key as an opaque handle and never decode it.

## Decision drivers

- Keep one readable document handle across the scan, cache and search layers.
- Preserve distinct arbitrary ids without SQLite's UTF-8 normalization losing
  an unpaired surrogate.
- Avoid a composite identity spreading through every index contract.
- Rebuild derived state instead of adding a one-off conversion path.
- Record the user's choice of conditional escaping and cache replacement.

## Considered options

1. **Keep the JSON encoding.** Rejected. It works, but it stores a serialized
   array as the identity and every reader has to decode it.
2. **Use a composite primary key of `(object_type, id)`.** Rejected. It removes
   the redundant column, but the key is also the file scan's document key. A
   composite identity becomes a pair across the file scan, framework, embeddings
   primary key and foreign key, vector index key contract and FTS5 key model.
   The id column is also the one that loses an unpaired surrogate.
3. **Hash the pair.** Rejected. It loses the readable handle.
4. **Use a `type:id` string with the id escaped when needed.** Selected. One
   column stays, the key is readable, and the encoding is injective for arbitrary
   id strings and all accepted type strings. Types containing a colon are
   rejected rather than given an ambiguous identity. The unpaired-surrogate
   guarantee is kept.

## Decision outcome

The cache key is the type and the id joined by a colon, for example
`project:structree-initial`.

1. The type part must not contain a colon. Registered type names are snake_case
   and never contain a colon, so the framework never reaches this case. A caller
   of the public `objectKey` function gets a `TypeError` for a type containing a
   colon rather than an ambiguous key.
2. The id part is the id used verbatim unless it contains a colon, a double
   quote, a backslash, a control character (U+0000 to U+001F), or an unpaired
   UTF-16 surrogate. When it contains any of those, the id part is
   `JSON.stringify(id)`.
3. A plain id part never contains a quote, so a JSON-encoded id part is
   recognizable by its leading double quote. The pair is recoverable by
   splitting on the first colon.

The framework never decodes the key. The type comes from the `object_type`
column and the exact id comes from the `json` column, because a SQLite UTF-8
TEXT binding normalizes an unpaired surrogate to U+FFFD while the JSON column
preserves it.

The cache is derived and rebuildable. The change bumps the schema version from
2 to 3. The existing cache file is replaced rather than migrated, and the next
sync rebuilds the index and re-embeds the corpus when embeddings are enabled.
A stale cache file is refused with the existing message
"use a fresh cache file and resync the Markdown sources". The repository's
migrator is additive only and refuses a changed primary key; it does not provide
a conversion for this change.

## Consequences

### Positive

- Ordinary keys remain readable, with one column and one handle across layers.
- Conditional JSON encoding preserves arbitrary ids, including unpaired
  surrogates, without changing source objects.
- Search-result identity comes from canonical object JSON rather than decoding
  an index handle.
- Replacing derived state avoids a cache conversion path to maintain.

### Negative

- Existing cache files cannot be reused. Rebuilding requires another sync and,
  when enabled, re-embedding the corpus.
- Exceptional ids make the key less visually simple, and public callers must
  handle `TypeError` for types containing a colon.
- The vault's own recorded contract changes: the cache key is no longer
  "the JSON encoding of the type and id pair". The parent session updates that
  contract object in the vault; this documentation lane does not write it.

## Confirmation

The encoding rule, SQLite normalization measurement, and replacement policy
were supplied by the parent session as the accepted specification on 2026-10-21.
This documentation lane did not repeat the measurement or verify the concurrent
implementation at runtime. The parent session owns code and test verification.

Static grep checks cover current key-format statements in the README, database
guide and structree skill. Historical decisions remain unchanged, including
decision 0002's previous encoding. No tests, cache replacement, sync, embedding
inference or vault writes were performed by this lane.

## Links

- [Historical SQLite search decision](0002-sqlite-search.md).
- [Database keys](../database.md#crud-and-keys).
- [Cache compatibility](../database.md#migration-and-compatibility).
- [Search and embedding storage](../../README.md#search-and-embedding-storage).
- [Vault UTF-8 boundary](../../src/lib/vault/utf8.ts).
