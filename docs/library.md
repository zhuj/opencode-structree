# Reusing the framework

All reusable implementation lives in `src/lib`. That directory imports its own
modules and declared external dependencies; it never imports the application's
12 core schemas, core registrations, CLI, examples, or package root. You can copy
`src/lib` into another Bun/TypeScript project or consume the package subpaths.

## Entry points

| Import | Purpose |
| --- | --- |
| `@local/object-mcp/lib` | Generic object registry, facade, generated MCP tools, configuration, common object schema, chunking, providers, repair parser, and vault exports. Requires explicit registrations. |
| `@local/object-mcp/vault` | Markdown documents with an injected header codec, confined files, owned stages, watcher lifecycle, checksums, and reconciliation helpers. No core object or SQLite requirement. |
| `@local/object-mcp/sqlite` | Database/table/index abstractions, prepared mutations, driver contracts, and `SqliteProcessLock`. |
| `@local/object-mcp/json-repair` | Standalone Effect-validated relaxed parsing and its lower-level repair APIs. |
| `@local/object-mcp/embeddings` | Embedding-provider factory and local ONNX/OpenAI implementations. |
| `@local/object-mcp/schemas` | The application's 12 concrete schemas and their ID schemas. |
| `@local/object-mcp` | Application convenience API: generic exports plus core schemas and registrations; `createFramework()` defaults to the core registry. |

The generic and application factories deliberately have different defaults.
`createFramework` from `/lib` requires `definitions` or `registry`. An explicit
empty array is valid. The root application factory still defaults to the 12
registered core types. The `ObjectFramework` class belongs to the generic
library, so its static `create` also requires explicit registrations.

The SQLite subpath remains separate because its legacy embedding adapter and
the framework provider have different contracts. Import the relevant provider
type from the layer you are extending; use `toIndexEmbeddingProvider` when
adapting a framework provider to an indexed table.

## Source boundary

| Location | Responsibility |
| --- | --- |
| `src/lib/base-schema.ts`, `types.ts`, `registry.ts` | Shared object fields, generic contracts, named schema registration, and Effect JSON codecs. |
| `src/lib/vault/` | Filesystem capabilities, Markdown codec, generic vault, watcher adapter, synchronization lifetime, and snapshot reconciliation. |
| `src/lib/filesystem.ts` | The object adapter: one vault codec per registration, `(type,id)` uniqueness, deterministic paths, and immutable object fields. |
| `src/lib/framework.ts` | File/index/provider composition, source commits, deferred embeddings, search, Effect serialization, events, and shutdown. |
| `src/lib/mcp.ts`, `mcp-input.ts` | Generated CRUD/search tools, Standard Schema adaptation, and configurable input repair. |
| `src/lib/sqlite/` | Typed tables, migrations, filters, full-text/vector indexes, cache tables, revision guards, and process coordination. |
| `src/lib/embeddings/`, `chunking.ts` | Local/remote inference, model assets, batching, normalization, and retrieval windows. |
| `src/lib/json-repair/` | Bounded JSON syntax repair, schema interpretation, key matching, structural routing, and final Effect decoding. |
| `src/lib/config.ts`, `errors.ts` | Validated settings and shared errors. |
| `src/schemas/` | The 12 concrete application schemas. `base.ts` is a compatibility re-export of the library primitives. |
| `src/registry.ts`, `framework.ts`, `index.ts`, `cli.ts` | Core registrations, the default application factory, public application exports, and process/transport wiring. |

Scripts remain executable application wiring; generic model, parsing, storage,
and indexing work is implemented in the library. There are no duplicate old
implementations outside `src/lib`.

## A different object application

Use the common object fields when you want generated CRUD, indexing, and search.
Your additional fields do not need the core application's `relations` structure.

```ts
import {
  BaseObjectSchema,
  createFramework,
  createMcpServer,
  type ObjectDefinition,
} from "@local/object-mcp/lib";
import { Schema } from "effect";

const NoteSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  topic: Schema.String,
  pinned: Schema.Boolean,
});

const note = {
  name: "note",
  directory: "notes",
  description: "Notes grouped by topic.",
  schema: NoteSchema,
} satisfies ObjectDefinition<typeof NoteSchema.Type>;

const objects = await createFramework({
  definitions: [note],
  baseDirectory: "/my/workspace",
  config: {
    root: "notes-vault",
    sqlite: { path: ".notes/index.sqlite" },
    embeddings: { provider: "disabled" },
  },
});

const server = createMcpServer(objects, { name: "notes", version: "1.0.0" });
// Attach the host's transport. The host owns objects.close() at shutdown.
```

This registration exposes five note tools and the four shared tools. It does
not register any core entity. Enable ONNX/OpenAI in `config.embeddings` to add
semantic and hybrid search; the same generic code handles their cache lifecycle.
The executable API example is [examples/notes-library.ts](../examples/notes-library.ts).

For an arbitrary frontmatter shape without the common object contract, use
`Vault<Header>` directly. It has no ID, timestamp, relation, or registry
requirements. See [the vault guide](vault.md) and
[examples/vault.ts](../examples/vault.ts).

## The facade contract

Framework creation starts the watcher and first reconciliation. By default it
waits for that pass before returning, preserving the library contract. Set
`waitForStartup: false` to return while the pass runs; `waitForStartup()` still
resolves with its report or rejects with its failure. A deferred startup failure
is reported through the framework's error channel without stopping the server.

The CLI's MCP server selects this deferral and answers requests without waiting
for the first pass. The diagnostic `sync` and `status` commands still wait, so
their printed reports describe a completed pass. During the initial pass,
`objects_status` reports `syncing: true` and `lastSync: null` until a completed
report exists. A search issued in that window may find nothing because existing
files have not yet been indexed. Create indexes its own object immediately, so
create followed by search still works. Reconciliation is the repair path, not a
read-only call; filename corrections can happen in the background after the
server starts answering. See [decision 0015](decisions/0015-defer-the-startup-reconciliation.md).

The built-in schemas enforce the [portable stored-id domain](core-schemas.md#shared-fields)
with `VALIDATION`. A caller may send an id in any case: at the very start of
create, get, update and delete, the framework lowercases the object id and every
relation identifier below the tool boundary, then validates the lowercased form.
Relation targets are not validated for existence, so a valid identifier naming
a nonexistent target is stored after normalization. Created objects use
`<type directory>/<id>.md`; reconciliation corrects a differing base name in its
existing directory and updates the indexed path. A filesystem that folds case or
normalizes names may spell the name differently while the target still names the
same file. The scanner accepts that spelling, leaves the file unchanged and
indexed at its actual path, and reports no issue. Only a different file holding
the target name is a conflict: both files remain unchanged and the object is
excluded with `RENAME_CONFLICT`. Nothing is overwritten.
Resync can therefore rename source files, not only write derived state.
A retired object remains
listed and searchable; callers check `retiredAt` to exclude it. The retirement
wording publishes existing behavior, not a change to listing or search.

The facade is the same for the application and for a custom registry, and the
generated tools advertise the bounds it enforces. The three read paths that a
client depends on most:

| Method | Contract |
| --- | --- |
| `list(type, {limit?, offset?}, signal?)` | Valid filesystem objects in identifier order. `limit` is an integer from 1 to 1000 and defaults to 50; `offset` is 0 or more and defaults to 0. A value outside those ranges fails with `VALIDATION`. |
| `search(request, signal?)` | Distinct objects from the derived index. `topN` is an integer from 1 to `config.search.maxTopN` and defaults to `config.search.defaultTopN`. See the exact mode and discovery guidance below. |
| `status()` | Index and synchronization state, registry, embedding metadata, historical reports and bounded known issues, not a provider-readiness verdict. |

`ObjectFramework` also exposes `prepareEmbeddings(signal?)`. It calls the
provider's optional `prepare`, or does nothing if no provider or hook exists.
A failure is recorded as the framework's last error, reported through `onError`,
and rethrown so the host can choose how to proceed. Framework creation does not
automatically call preparation or fetch model assets; a library host decides
whether to call this method. The CLI calls it for `serve` and `sync`, not for
the read-only `status` report, and keeps serving full-text search after a
reported preparation failure.

For local ONNX, preparation ensures the pinned snapshot files exist, fetching
missing files when `embeddings.localFilesOnly` is false (the built-in default).
A complete snapshot is returned without a network request. True retains
offline-only operation: a missing snapshot reports `MODEL_NOT_CACHED` without
fetching. Preparation does not load the model; inference loads it lazily when
needed. Snapshot presence is not proof that later inference will succeed, and
the existing semantic/hybrid errors and explicit fulltext behavior are unchanged.
See [embedding semantics](embeddings.md#local-onnx) and
[decision 0010](decisions/0010-prepare-the-model-snapshot-at-startup.md).

The generated tools publish this search and mode guidance verbatim:

> Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The server's startup reconciliation runs in the background, so a search issued right after it starts may find nothing; objects_status reports whether a synchronization is still running. The body field is omitted unless includeBody is true. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.

The query and type-filter descriptions are:

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

The status description is:

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

The configured provider label and the instance's fingerprint/dimensions are
metadata, not usability guarantees. Query encoder overflow maps to `INTERNAL`,
not `VALIDATION`. A successful, fully paginated source listing enumerates valid
objects; incomplete or failed listing cannot establish absence. Revalidation
does not guarantee against subsequent source edits. Resync is a write, not a
prerequisite for read-only investigation.

The 128-distinct-token cap is a self-imposed bound on the generated FTS5 MATCH
expression, not a SQLite limit. It fails rather than truncates, so callers
shorten their own over-limit queries. Tokens are counted before SQLite case and
diacritic folding; case variants count separately. On 2026-10-21 SQLite 3.53.4
executed 2000 AND-joined and 5000 OR-joined terms without error. See
[decision 0011](decisions/0011-publish-the-observed-surface-and-reject-empty-identifiers.md).
Hybrid queries with no lexical tokens still return semantic-ranked hits with
`fulltextRank: null` and a set `semanticDistance`, without lexical evidence.

Two further details of that contract are visible to the client:

- A provider that cannot embed the query raises `EMBEDDINGS_UNAVAILABLE` with
  the provider's own message as the cause. The message ends with `Search with
  mode "fulltext" to query without embeddings.`, and an explicitly requested
  semantic or hybrid search is never downgraded to full-text.
- The status report bounds its issue list to 50 entries and adds
  `issuesTotal`, `issuesTruncated` and `issuesByCode`, a count per issue code.
  The stored synchronization report is not mutated, so `resync()` still
  returns every issue.

The list `includeBody` option belongs to the tool layer, not to the facade's
list operation. The facade list returns complete objects; the generated list tool takes an
optional `includeBody` boolean that defaults to true and omits the `body`
field of each returned object when it is false.

A facade that exposes `config.search` makes the generated search schema state
its own `maxTopN` and `defaultTopN`. A facade without configuration advertises
the built-in defaults of 100 and 10.

### Search hit evidence

`SearchHit` adds `readonly fulltextExcerpt?: string | null`. Custom producers
that omit it remain valid; absence means no excerpt was supplied, not that no
lexical match exists. The concrete index emits it on every hit: a string for a
lexical match in fulltext or hybrid, regardless of fusion weight, and null for
semantic-only hits, including those in hybrid results. The MCP output property
is likewise optional, accepting only string or null when present.

SQLite chooses bounded evidence from indexed name, title or raw YAML Markdown
with a 32-FTS-token budget. The public text keeps the first
`search.maxMatchCharacters` Unicode code points (1200 by default), including
native `...` markers. It has no coordinates, HTML highlighting or column
attribution; source markup is text, not sanitized HTML. It is discovery evidence,
not a complete match explanation: distant/cross-column AND terms may be absent,
and a small cap or long token may clip the visible match.

`matchedChunk` remains the nullable semantic `{ index, start, end, text }` with
raw-source code-point coordinates; fulltext-only hits keep it null. `includeBody`
controls only the `body` property. Existing per-hit checksum revalidation discards
the whole hit and excerpt without refill or additional reads; it does not promise
freshness after the check. Scores, ranks, ordering, filters and generation retain
their existing meaning. See [decision 0009](decisions/0009-fulltext-search-excerpts.md).

## Copying the library

Copy `src/lib` as a unit and preserve its internal relative imports. Add the
runtime dependencies and TypeScript settings from this package's manifest,
including Bun/Node types, strict mode, and support for `.ts` import specifiers.
Native SQLite and ONNX packages remain separately installed dependencies.

For a smaller integration, the vault subpath depends on its own files, the
shared error module, `yaml`, and `chokidar`; the supplied Effect codec example
also depends on `effect`. The vault has no SQLite, MCP, model, or core schema
imports. Generic SQLite and JSON-repair subpaths can likewise be used without
constructing the object application. The `/lib` convenience barrel exposes the
complete framework and therefore loads more modules than these focused subpaths.

The package is source-only and private. Reuse through a workspace/path dependency,
copying the directory, or publishing your own package are host choices; this
refactor does not publish it to a registry.

## Migration from the previous layout

The root API and `/schemas`, `/sqlite`, and `/json-repair` package subpaths remain
available. The new `/lib`, `/vault`, and `/embeddings` subpaths support independent
reuse. Internal source imports such as `src/mcp.ts`, `src/filesystem.ts`, and
`src/sqlite/table.ts` move to the corresponding paths below `src/lib`.

Use the root `createFramework` for the existing core application and the `/lib`
factory for another registry. Hosts calling `ObjectFramework.create()` directly
must now pass their registry or definitions. FileStore cleanup is asynchronous
because the vault owns directory handles and active file-operation leases.

The cache schema and its existing object/embedding identities are unchanged.
Moving TypeScript modules does not require rewriting Markdown files, renaming
registered directories, or migrating the search database.

## Verification boundary

[The library-boundary test](../test/library-boundary.test.ts) resolves every
relative library import and rejects dependencies on app files or package-root
self imports. It also exercises public subpaths, requires explicit generic
registrations, verifies core application defaults, and runs a custom Notes
framework through actual Markdown, native SQLite FTS, and MCP tool listing.

The ordinary framework, schema, parser, MCP, vector/cache, provider, filesystem,
and lifecycle suites verify the integrated implementation. See
[validation evidence](validation.md) for the current run and its limits.
