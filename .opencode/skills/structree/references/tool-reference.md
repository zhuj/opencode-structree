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
| `object` | object | The full object: `id`, `name`, `title`, `description`, `createdAt`, `updatedAt`, `retiredAt`, `tags`, `metadata`, `relations`. |
| `body` | string, optional | The Markdown content. |

Returns the stored object, its body, its path and its checksum.

Fails with `ALREADY_EXISTS` when the id is taken, and with `VALIDATION` when a
field does not match the schema.

### `<type>_get`

| Parameter | Type | Notes |
| --- | --- | --- |
| `id` | string | The object id. |

Returns the object, its body, its path and its checksum. Fails with
`NOT_FOUND` when there is no such object.

### `<type>_update`

Replaces a complete revision. This is not a patch.

| Parameter | Type | Notes |
| --- | --- | --- |
| `id` | string | The object id. |
| `object` | object | The complete new object. |
| `body` | string | The complete new Markdown body. |
| `expectedChecksum` | string | The checksum of the revision being replaced. It must not be empty. |

`id` and `createdAt` are immutable; sending a different value fails with
`IMMUTABLE_ID` or `IMMUTABLE_CREATED_AT`. A stale checksum fails with
`CHECKSUM_CONFLICT`.

### `<type>_delete`

| Parameter | Type | Notes |
| --- | --- | --- |
| `id` | string | The object id. |
| `expectedChecksum` | string | The latest checksum. It must not be empty. |

Returns `{ type, id, deleted: true }`.

### `<type>_list`

Lists the objects of that type, in identifier order.

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

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | Search text. It must not be blank. Full-text mode treats words literally, without FTS operators. |
| `mode` | `fulltext`, `semantic`, `hybrid` | `hybrid` when an embedding provider is configured, `fulltext` otherwise | |
| `types` | string[] | every type | The registered type names. An empty array searches no types. |
| `topN` | integer | the advertised default, 10 by default | From 1 to the advertised maximum, 100 by default. Read both numbers off the tool schema, because the server states them there. |
| `includeBody` | boolean | false | The body is returned only when this is explicitly true. |

Returns `{ mode, hits, indexGeneration }`. A hit is `{ type, id, name, title,
path, checksum, score, fulltextRank, semanticDistance, matchedChunk }`, where
`fulltextRank` and `semanticDistance` are null when that ranking did not apply,
`matchedChunk` is `{ index, start, end, text }` or null, and `body` is present
only when `includeBody` was true.

Two things to keep in mind. Search is capped by `topN` and can miss recent
changes, so it is a way to discover ids, not a way to prove that something does
not exist. And semantic or hybrid search needs an embedding provider: without
one you get `EMBEDDINGS_DISABLED`, and with one that fails you get
`EMBEDDINGS_UNAVAILABLE` and the message tells you to use `mode: "fulltext"`.

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

Takes no arguments. Returns the index generation and counts, the registered
type names, the synchronization state, the embedding provider and fingerprint,
the last error, and the issue list.

The issue list is bounded to the first 50 entries, so the response stays
small. It comes with `issuesTotal` (how many issues exist), `issuesTruncated`
(whether the list was cut) and `issuesByCode` (the count per code, over the
whole set). This tool is read-only.

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
| `VALIDATION` / `VALIDATION_ERROR` | The input does not match the schema | Check the field list in `objects_definitions` |
| `ALREADY_EXISTS` | The id is taken | `get` it and update it, or choose another id |
| `NOT_FOUND` | No object with that id | Search for the id instead |
| `DUPLICATE_ID` | Several objects of that type share one id, so a read of that id cannot resolve which object it means | The error names the id. Report it for operator resolution; the exposed tools cannot repair it |
| `CHECKSUM_CONFLICT` | The revision moved since you read it | `get` it again and reapply the change |
| `IMMUTABLE_ID` / `IMMUTABLE_CREATED_AT` | An update tried to change a frozen field | Keep the original values |
| `UNKNOWN_TYPE` | The type name is wrong | The details carry `registeredTypes` |
| `EMBEDDINGS_DISABLED` | Semantic or hybrid search without a provider | Use `mode: "fulltext"` |
| `EMBEDDINGS_UNAVAILABLE` | The embedding provider failed | Use `mode: "fulltext"` |
| `SOURCE_CONFLICT` | The server cannot establish a consistent state for that type: the scan did not complete, or it found invalid or duplicate objects | The details carry the scan issues and `objects_status` carries the counts. Report it for operator resolution; creating under a different id does not clear it |
| `SCAN` | The read needed to establish object identity could not be completed | The message says why, but names no object. Report it for operator investigation; another `get` may fail for the same reason |
| `CONFIG` | The server was started with an invalid configuration | Report the diagnostic and ask for operator assistance; do not change the configuration yourself |
| `REGISTRY` / `INVALID_DEFINITION` | A registered type is not usable | A server-side fault, not a caller mistake. Report it |
| `CLOSED` | The server is shutting down | Do not retry in this session |
