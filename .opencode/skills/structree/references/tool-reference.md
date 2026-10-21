# Tool reference

The server registers 64 tools: five verbs for each of the twelve object types,
plus four global tools.

In code mode they are namespaced (`tools.structree.project_get`); on the wire the
name is `project_get`, and a host that prefixes local MCP tools presents it as
`structree_project_get`. The type names are the ones in
`references/object-model.md`, and the search tool publishes them as an enum, so
a wrong name is rejected with the valid ones in the message.

## The per-type verbs

Every type has the same five. Create, get and update all return the stored
object in the same shape: `{ type, object, body, path, checksum }`.

### `<type>_create`

Creates one object. Supply the complete object, including every base field and
the relation keys, even when they are empty or `null`. The body is optional
and defaults to an empty string.

| Parameter | Type | Notes |
| --- | --- | --- |
| `object` | object | The complete object. Identifiers must not be empty. |
| `body` | string, optional | The Markdown content. |

Returns the stored object, its body, its path and its checksum.

Fails with `ALREADY_EXISTS` when the id is taken, and with `VALIDATION` when a
field does not match the schema, including an empty object id, owner identifier
(for example `relations.project = ""`) or identifier inside a relation array.
An empty identifier is refused before any target is considered. Relation targets
are not validated for existence: a non-empty id naming a nonexistent target is
still stored as written. All base fields and relation keys are required.

### `<type>_get`

| Parameter | Type | Notes |
| --- | --- | --- |
| `id` | non-empty string | Object identifier. Must not be empty. |

Returns the object, its body, its path and its checksum. Fails with
`NOT_FOUND` when there is no such object.

### `<type>_update`

Replaces a complete revision. This is not a patch.

| Parameter | Type | Notes |
| --- | --- | --- |
| `id` | non-empty string | Object identifier. Must not be empty. |
| `object` | object | The complete object. Identifiers must not be empty. |
| `body` | string | The complete new Markdown body. |
| `expectedChecksum` | string | The checksum of the revision being replaced. It must not be empty. |

`id` and `createdAt` are immutable; sending a different value fails with
`IMMUTABLE_ID` or `IMMUTABLE_CREATED_AT`. A stale checksum fails with
`CHECKSUM_CONFLICT`.

### `<type>_delete`

| Parameter | Type | Notes |
| --- | --- | --- |
| `id` | non-empty string | Object identifier. Must not be empty. |
| `expectedChecksum` | string | The latest checksum. It must not be empty. |

Returns `{ type, id, deleted: true }`.

### `<type>_list`

Lists the objects of that type, in identifier order. A retired object is still
listed and searchable; check `retiredAt` to exclude it. This publishes existing
behavior, not a change to listing or search.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `limit` | integer | 50 | Between 1 and 1000. |
| `offset` | integer | 0 | How many to skip. A nonnegative integer. |
| `includeBody` | boolean | true | Set it to false to omit the Markdown body. |

Returns `{ objects, total }`. An entry is `{ type, object, body, path, checksum }`,
or the same without `body` when `includeBody` is false. The bodies are the
bulk of a listing, so dropping them is the cheapest way to reduce a list to a
manageable size.

## The global tools

### `objects_search`

> Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The body field is omitted unless includeBody is true. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | See the exact advertised query description below. |
| `mode` | `fulltext`, `semantic`, `hybrid` | `hybrid` with a provider instance, otherwise `fulltext` | See the exact advertised mode description below. |
| `types` | string[] | every type | See the exact advertised type-filter description below. |
| `topN` | integer | the advertised default, 10 by default | From 1 to the advertised maximum, 100 by default. Read both numbers off the tool schema, because the server states them there. |
| `includeBody` | boolean | false | The body is returned only when this is explicitly true. |

`query`:

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

`types`:

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

`mode`:

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.

CLI `serve` and `sync` prepare the local ONNX provider; the read-only `status`
command does not. `embeddings.localFilesOnly` defaults to false and permits
fetching missing pinned model files. True keeps offline-only behavior and
reports `MODEL_NOT_CACHED` for a missing snapshot without fetching. Preparation
needs no network request for a complete snapshot and does not load the model;
inference still loads it lazily. A reported preparation failure does not stop
the server or full-text search. Library hosts choose whether to call
`prepareEmbeddings()`; creation does not prepare automatically. No successful
preparation or status metadata guarantees inference readiness. Use explicit
fulltext after provider errors rather than changing configuration yourself.

Returns `{ mode, hits, indexGeneration }`. A hit is `{ type, id, name, title,
path, checksum, score, fulltextRank, fulltextExcerpt?, semanticDistance, matchedChunk }`, where
`fulltextRank` and `semanticDistance` are null when that ranking did not apply,
`matchedChunk` is semantic `{ index, start, end, text }` or null (null for
fulltext-only hits), and `body` is present
only when `includeBody` was true.

Hybrid hits for a query with no lexical tokens have `fulltextRank: null` and a
set `semanticDistance`, with no lexical evidence.

`fulltextExcerpt` is optional string-or-null on the public surface. The concrete
server always supplies a string for a lexical match, including hybrid with zero
lexical fusion weight, and null otherwise, including semantic-only hybrid hits.
Older/custom producers may omit it, meaning no excerpt was supplied, not that
no lexical match exists. Selection can return name/title or raw YAML Markdown;
there is no promise of a particular column or highest-scoring contribution.
A 32-FTS-token extraction budget precedes the cap of the first
`search.maxMatchCharacters` Unicode code points (1200 by default), including
native `...` markers. Surrogate pairs are not split. This is discovery evidence,
not a complete match explanation: every AND term need not appear, and a small cap
or long token can clip the visible match. The excerpt has no coordinates or
chunk index, no column provenance and no HTML highlighting. Source markup is
text, not sanitized HTML. Semantic `matchedChunk` retains raw-source code-point
coordinates and its existing cap. `includeBody` controls only the `body` property,
not evidence disclosure. Stale/unreadable candidates lose their whole hit and
excerpt without refill; use get for current complete content.

Only a complete successful paginated list can support an absence claim about
valid objects. Revalidation is not a guarantee against subsequent edits.
Identical tokens are deduplicated before SQLite case and diacritic folding;
case variants count separately. The 128-token cap is a self-imposed bound on the
generated FTS5 MATCH expression, not a SQLite limit, and fails rather than
truncates. On 2026-10-21 SQLite 3.53.4 executed 2000 AND-joined and 5000 OR-joined
terms without error. See [decision 0011](../../../../docs/decisions/0011-publish-the-observed-surface-and-reject-empty-identifiers.md).
Two words match anywhere rather than as a phrase; `reconcil*`
searches `reconcil`, and `cafe` can match `café`. Hybrid's provider can fail
before lexical evaluation, even when punctuation produces no lexical tokens.
No semantic/hybrid failure silently falls back to fulltext.

### `objects_definitions`

| Parameter | Type | Notes |
| --- | --- | --- |
| `type` | string, optional | Return only this registered type. |

Returns the registered types with their canonical JSON Schemas, the shared
workflow contract as guidance strings, and, when a type is given, that one
type. An unknown type fails with `UNKNOWN_TYPE`, whose details carry
`registeredTypes`.

This is the authority on the schema of the server you are talking to.

### `objects_status`

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

Takes no arguments. Returns the index generation and counts, the registered
type names, the synchronization state, the embedding provider and fingerprint,
the last error, and the issue list.

The issue list is bounded to the first 50 entries, so the response stays
small. It comes with `issuesTotal` (how many issues exist), `issuesTruncated`
(whether the list was cut) and `issuesByCode` (the count per code, over the
whole set). This tool is read-only.

`embeddings.provider` is the configured label; fingerprint and dimensions are
metadata, not successful-inference evidence. Known issues do not establish
exhaustive current health. Resync is not a read-only investigation prerequisite.

### `objects_resync`

Takes no arguments. Refreshes the searchable state and returns the scanned,
indexed, unchanged and deleted counts, every issue it found, and the new
generation.

This is the repair path, and unlike the status snapshot it keeps every issue.
It writes derived state, so it is not a read-only call: do not use it in an
investigation that must not change anything.

## Error codes

A call that fails inside a tool comes back as `{ error: { code, message, details } }`
with `isError` set. A call rejected before the tool runs, because the arguments
did not match the schema, is a different thing: the message names the argument
that was wrong.

| Code | Meaning | What to do |
| --- | --- | --- |
| `VALIDATION` / `VALIDATION_ERROR` | The input does not match the schema, including an empty object, owner or relation-array identifier | Supply a non-empty identifier; check `objects_definitions` for other field errors |
| `ALREADY_EXISTS` | The id is taken | `get` it and update it, or choose another id |
| `NOT_FOUND` | No object with that id | Search for the id instead |
| `DUPLICATE_ID` | Several objects of that type share one id, so a read of that id cannot resolve which object it means | The error names the id. Report it for operator resolution; the exposed tools cannot repair it |
| `CHECKSUM_CONFLICT` | The revision moved since you read it | `get` it again and reapply the change |
| `IMMUTABLE_ID` / `IMMUTABLE_CREATED_AT` | An update tried to change a frozen field | Keep the original values |
| `UNKNOWN_TYPE` | The type name is wrong | The details carry `registeredTypes` |
| `EMBEDDINGS_DISABLED` | Semantic or hybrid search without a provider | Use `mode: "fulltext"` |
| `EMBEDDINGS_UNAVAILABLE` | The embedding provider failed | Use `mode: "fulltext"` |
| `INTERNAL` | An internal failure, including lexical encoder overflow above 128 distinct extracted tokens | Shorten an over-limit query; report other internal failures |
| `SOURCE_CONFLICT` | The server cannot establish a consistent state for that type: the scan did not complete, or it found invalid or duplicate objects | The details carry the scan issues and `objects_status` carries the counts. Report it for operator resolution; creating under a different id does not clear it |
| `SCAN` | The read needed to establish object identity could not be completed | The message says why, but names no object. Report it for operator investigation; another `get` may fail for the same reason |
| `CONFIG` | The server was started with an invalid configuration | Report the diagnostic and ask for operator assistance; do not change the configuration yourself |
| `REGISTRY` / `INVALID_DEFINITION` | A registered type is not usable | A server-side fault, not a caller mistake. Report it |
| `CLOSED` | The server is shutting down | Do not retry in this session |
