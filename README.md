# Object MCP

A Bun/TypeScript framework that turns an **Effect-schema object registry** into MCP CRUD tools and searchable Markdown objects. The filesystem is authoritative. SQLite contains derived metadata, FTS5 data, and `sqlite-vec` embedding rows that can be rebuilt from the files.

The package includes the 12 requested schemas, a standalone stdio server, and a facade that can attach tools to an existing plugin server. It has no application-level Zod schemas. Effect defines the domain, persistence codecs, configuration validation, and MCP JSON schemas; Effect also owns the runtime and in-process serialization.

The SQLite cache uses the supplied `Database`, `Table`, `IndexedTable`, FTS, vector, and prepared-mutation abstractions, adapted to Effect and the existing cache format. Biome provides formatting, recommended lint checks, and import organization.

Generated MCP tools include the supplied relaxed JSON parser's mechanisms adapted to Effect. They repair unambiguous field spelling, misplaced nesting, stringified containers, and selected scalar representations, then require the original strict schema to validate the complete arguments before a handler runs. Canonical tool schemas and outputs remain strict. See [relaxed JSON and MCP arguments](docs/relaxed-json.md).

All reusable implementation now lives in **`src/lib`**, with no imports of the core application schemas. The generic `/lib` entry point takes explicit registrations; the root entry point preserves the 12 built-in defaults. The supplied vault/storage concepts are implemented as a typed Markdown vault, confined filesystem, owned publication stages, watcher lifecycle, reconciliation helpers, and a reusable SQLite process lock. See [reusing the library](docs/library.md) and [vault design and APIs](docs/vault.md).

## Quick start

Requirements: Bun **1.4.3 or later** and a platform supported by the native SQLite/ONNX packages. The implementation was verified on Linux x64 with the exact versions in the lockfiles. Model weights are downloaded separately.

```sh
ONNXRUNTIME_NODE_INSTALL=skip bun install --frozen-lockfile
bun run check
bun run prepare-model
bun run seed-example
bun start
```

`ONNXRUNTIME_NODE_INSTALL=skip` skips the optional ONNX GPU download; the CPU runtime is bundled in the dependency. `prepare-model` explicitly downloads the pinned multilingual E5 q8 model, verifies its file hashes, and runs a synthetic inference check. Normal server operation then uses the local snapshot. `seed-example` creates one example of each entity; existing example IDs are left intact.

`bun start` communicates MCP on stdin/stdout. Connect it to an MCP client; it is not an interactive shell prompt. Diagnostics go to stderr. A typical client configuration is:

```json
{
  "mcpServers": {
    "objects": {
      "command": "bun",
      "args": [
        "/absolute/path/object-mcp/src/cli.ts",
        "serve",
        "--config",
        "/absolute/path/object-mcp/object-mcp.config.json"
      ]
    }
  }
}
```

The included JSON configuration is complete. Relative paths resolve from its directory, so the MCP client's working directory does not alter the data location.

For a first run using full-text search only:

```sh
bun src/cli.ts serve --config examples/fulltext.config.json
```

To inspect or rebuild the derived index without starting a transport:

```sh
bun src/cli.ts sync --config object-mcp.config.json
bun src/cli.ts status --config object-mcp.config.json
```

Both commands perform startup reconciliation. They print JSON and exit with code `2` when the reconciliation reports source or embedding issues. They never rewrite source files.

## Registry and plugin integration

Definitions have a registry name, a directory, a description, and an Effect schema. Registration happens before framework creation. The running framework takes a snapshot so its tools and watched directories agree.

For a separate application, import from `@local/object-mcp/lib` and pass only its definitions. [examples/notes-library.ts](examples/notes-library.ts) creates a Notes-only facade with nine tools. [examples/vault.ts](examples/vault.ts) uses an unrelated frontmatter schema directly, without the shared object fields or any database. The following example extends this package's core application.

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import {
  BaseObjectSchema,
  ObjectRegistry,
  coreDefinitions,
  createFramework,
  registerObjectTools,
} from "./src/index.ts";

const NoteSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    relatedTo: Schema.Array(Schema.String).annotate({
      description: "Related note identifiers.",
    }),
  }).annotate({ description: "Note relationships." }),
});

const registry = new ObjectRegistry(coreDefinitions).register({
  name: "note",
  directory: "notes",
  description: "Workspace notes.",
  schema: NoteSchema,
});

const objects = await createFramework({
  registry,
  baseDirectory: "/my/workspace",
  config: { root: "objects" },
});

const server = new McpServer({ name: "my-plugin", version: "1.0.0" });
registerObjectTools(server, objects);

const unsubscribe = objects.onEvent(event => {
  if (event.kind === "sync_completed") {
    process.stderr.write(`Indexed generation ${event.report.generation}\n`);
  }
});

// At the host plugin's shutdown boundary:
unsubscribe();
await objects.close();
```

Alternatively, `createMcpServer(objects, info)` constructs the server for you. Closing one MCP server/transport does not close the shared facade; the host owns `objects.close()`. The standalone CLI connects cleanup to its actual stdio transport and process signals.

Both registration functions inherit `objects.config.mcp`. An optional third argument overrides input repair settings, for example `registerObjectTools(server, objects, {inputRepair: {enabled: false}})` to require canonical arguments. The default enables bounded repair and preserves explicit required values, object IDs, timestamps, and checksum guards.

`examples/plugin.ts` is a typechecked embedding example. A host can use the official SDK's HTTP handler with the same `createMcpServer` factory; create the shared framework outside the per-connection factory. HTTP hosting and authentication belong to that host.

### Public facade

| Method | Contract |
| --- | --- |
| `create(type, object, body?, signal?)` | Validate a complete object and create its Markdown file. |
| `get(type, id, signal?)` | Read the current filesystem object, body, path, and checksum. |
| `update(type, id, object, body, expectedChecksum, signal?)` | Replace the complete object/body, preserving ID and `createdAt`. |
| `delete(type, id, expectedChecksum, signal?)` | Delete the source file and invalidate its derived search data. |
| `list(type, {limit?, offset?}, signal?)` | Read valid filesystem objects in ID order; default limit 50, maximum 1,000. |
| `search(request, signal?)` | Retrieve distinct objects from the synchronized index. |
| `resync(signal?)` | Wait for shared reconciliation and report issues. |
| `requestResync()` | Schedule a coalesced background reconciliation. |
| `status()` | Report index generation, readiness, pending work, and issues. |
| `onEvent(listener)` | Subscribe to tool mutations, filesystem notifications, and completed sync reports. Returns an unsubscribe function. |
| `close()` | Cancel pending work, drain active work, and release watcher, model, runtime, and database resources. |

Facade inputs accept domain `Date` objects or the canonical JSON representation. MCP inputs/outputs and YAML dates are ISO strings. A stored response is `{type, object, body, path, checksum}`.

## The 12 schemas and their tools

Every registration produces `_create`, `_get`, `_update`, `_delete`, and `_list` tools. The built-in registry therefore exposes **60 entity tools plus four shared tools**, for **64 tools** total.

| Schema | Registry/tool prefix | Directory |
| --- | --- | --- |
| `ProjectSchema` | `project` | `projects/` |
| `ProjectGoalSchema` | `project_goal` | `project-goals/` |
| `FeatureSchema` | `feature` | `features/` |
| `ScenarioSchema` | `scenario` | `scenarios/` |
| `ScenarioAcceptanceCriteriaSchema` | `scenario_acceptance_criteria` | `scenario-acceptance-criteria/` |
| `ADRSchema` | `adr` | `adrs/` |
| `ContractSchema` | `contract` | `contracts/` |
| `InterfaceSchema` | `interface` | `interfaces/` |
| `EntitySchema` | `entity` | `entities/` |
| `UnitTestSchema` | `unit_test` | `unit-tests/` |
| `ScenarioTestSchema` | `scenario_test` | `scenario-tests/` |
| `AcceptanceTestSchema` | `acceptance_test` | `acceptance-tests/` |

The shared tools are `objects_search`, `objects_resync`, `objects_status`, and `objects_definitions`. The last returns JSON schemas derived from the Effect definitions, including descriptions and required keys.

The domain schemas preserve all required fields from the supplied specification. Nullable fields require explicit `null`; canonical objects include every required array and nested commitment struct. `Feature` has no `partOf`; there is no `belongsTo` or separate `Acceptance` entity. See [the field and relationship reference](docs/core-schemas.md).

Schema validation checks shape. It does not check reference existence, inverse relationships, duplicate reference IDs, or dependency/hierarchy cycles. The filesystem layer separately needs one unambiguous `(type,id)` to address a stored object. Conflicting files with the same identity are reported and excluded from indexing; identical ID strings in different registered types are allowed.

## Relaxed MCP arguments

When an LLM mixes complex fields, the input adapter can map `created_at` to `createdAt`, place `relations.commitment_goals` at `relations.commitment.goals`, infer a missing `object` wrapper on create, or decode a stringified relation object. Metadata and tag contents remain opaque to field routing. Unknown fields, ambiguous destinations, collisions, missing required values, and invalid final schemas produce errors before mutations.

Accepted repairs are reported in `response._meta["object-mcp/input-repair"].repairs`; reports contain paths and descriptions, not copies of object values. Defaults limit input to 5,000,000 JSON bytes, depth 32, 50,000 nodes, and 100 repair notices. Delimiter splitting is disabled by default, because delimiters may belong to IDs. Repair never invents missing field values, including `null`, empty relationship collections, owner IDs, timestamps, or checksums.

The async `parseJson(input, effectSchema, options?)` API is available through `@local/object-mcp/json-repair` for standalone use. The [parser guide](docs/relaxed-json.md) includes examples, configuration, reports, supported conversions, and the boundary between repairable tool arguments and outer JSON-RPC parsing.

## File format and CRUD semantics

The **complete object lives in YAML frontmatter**. The Markdown body is a separate content field; `description` remains a required object property. The registered directory determines the object's type.

```md
---
id: project-example
name: object-framework
title: Object framework
description: Filesystem-backed architecture objects
createdAt: 2026-10-15T12:00:00.000Z
updatedAt: 2026-10-15T12:00:00.000Z
retiredAt: null
tags:
  priority: high
metadata: {}
relations:
  partOf: null
---
# Design

Long-form content belongs here.
```

All timestamps are caller-supplied. An update is a full replacement, including its body; it is not a deep partial patch. The framework keeps `id` and `createdAt` immutable and requires the current checksum on update/delete. Set `retiredAt` explicitly when retirement is desired; delete performs an actual file deletion.

Framework-created filenames use a SHA-256 hash of the JSON-encoded ID. This permits unrestricted string IDs without turning them into paths. Human-created `.md` filenames and subdirectories are supported; an external rename updates the indexed path without recomputing unchanged vectors. Changing an object's `name` does not rename its file.

Creating a new ID requires its type directory to have no invalid or conflicting source files, so the store can establish that the identity is unused. Existing valid objects can still be read, updated, or deleted while other files are being repaired.

YAML is parsed as version 1.2 with duplicate keys rejected and bounded alias expansion. Unknown object fields and non-JSON metadata values are rejected at the persistence boundary rather than silently discarded. The domain `metadata` schema remains `Record<string, any>`; storage cannot represent functions, cyclic values, class instances, `undefined`, or nonfinite numbers faithfully. All required domain fields remain present.

Writes publish a complete temporary file in the same directory, synchronize it, and replace/publish the destination atomically. Full replacement rewrites frontmatter formatting and comments. Files must be UTF-8; the checksum covers the entire decoded source, preserving valid original bytes including a BOM and line endings. Symlinked object files/directories are rejected or excluded. Hidden files/directories are excluded from discovery.

The reusable vault checks temporary inode ownership and staged payloads before publication, preserves ordinary file permissions on replacement, and cleans up only its owned temporary name. It selects Linux directory-descriptor confinement when available and exposes a portable path-check mode. Exact guarantees, stage ownership, and platform limits are documented in [the vault guide](docs/vault.md).

## Search and embedding storage

Example `objects_search` arguments:

```json
{
  "query": "recover object search after an interrupted synchronization",
  "mode": "hybrid",
  "types": ["adr", "contract", "scenario"],
  "topN": 5,
  "includeBody": false
}
```

| Mode | Ranking |
| --- | --- |
| `fulltext` | SQLite FTS5 BM25 over names, titles, and complete raw files. Words are literal tokens joined with AND; raw FTS operators are not accepted. |
| `semantic` | Exact cosine distance through `sqlite-vec`; the best matching whole-file/chunk vector determines each object's rank. |
| `hybrid` | Weighted reciprocal rank fusion of the document-level full-text and semantic candidate lists. |

The default is hybrid when a provider is configured, otherwise full-text. Explicit semantic/hybrid requests fail clearly when embeddings are disabled or the provider cannot embed the query. Embedding failures during indexing leave full-text search available and mark affected objects pending.

Omitting `types` searches all registered types. An empty `types` array searches none. Unknown names fail validation. Both ranking methods filter types **before** their candidate limits, and multiple chunks never consume multiple positions in the final object result. `topN` is a maximum; fewer eligible matches may exist.

Results include type, ID, name/title, source path/checksum, score, full-text rank, semantic distance, and the matching chunk excerpt when applicable. `includeBody` adds the full body. Excerpts are capped by `search.maxMatchCharacters`; their `[start,end)` offsets refer to the returned text in Unicode code points. A score is a ranking value, not a probability. Hybrid fusion examines `topN * candidateMultiplier` candidates per method, so increasing this setting can change the fused result order.

SQLite stores:

| Derived data | Identity/content |
| --- | --- |
| `object_meta` | JSON-encoded `(type,id)` key, ID, type, path, checksum, canonical object JSON, raw file, body, embedding freshness metadata. |
| `object_fts` | FTS5 search projection synchronized with object metadata. |
| `embeddings` | Primary key `(object_key, chunk_index)`, float32 embedding, source text, code-point offsets; joined to object checksum and active model/chunk fingerprint. |
| Index state/issues | Generation and last reconciliation issues. |

Embedding index `0` represents the **whole raw file, including frontmatter**. Positive indices cover the full file in 1,200-code-point chunks by default, with 120-code-point overlap: **10%**, a 1,080-code-point step. The last chunk includes the end of the file.

For text beyond a model's context window, the provider processes every internal window and normalizes their weighted mean. This whole-file vector is an approximation that covers all source content. It is not equivalent to unlimited-context attention. Retrieval chunks retain more local meaning. See [embedding details](docs/embeddings.md).

The default provider uses local ONNX CPU inference with a pinned multilingual E5 model, 384 dimensions, q8 weights, and its query/passage prefixes. The OpenAI provider supports endpoint/model/dimensions configuration, batching, timeouts, retries, cancellation, and an API key read from an environment variable. Use `examples/openai.config.json` to select it. Object text and queries are sent to that configured endpoint when this provider is selected. The source package contains no API key.

## Database and table extension API

The `@local/object-mcp/sqlite` export exposes `Database`, `Table`, `IndexedTable`, `Column`, `Filter`, `Migrator`, `FTSIndex`, `VectorIndex`, prepared mutations, and `SqliteProcessLock`. `columnsFromEffect(schema)` derives validated SQLite converters from Effect's canonical JSON codecs. `examples/database.ts` demonstrates a typed plugin cache with optional provider injection.

The framework uses these classes for metadata, chunk rows, generation state, and reconciliation issues. Tables support custom and composite primary keys, so existing v2 caches retain their `(object_key, chunk_index)` rows and stored embeddings. Migrations are additive and reject incompatible layouts without dropping columns or inventing values. Prepared indexed operations compute embeddings before a short, revision-guarded SQL commit.

See [the database guide](docs/database.md) for the supplied-file mapping, API examples, migration rules, cancellation, driver capabilities, and transaction boundaries.

## Synchronization, locks, and lifecycle

Startup waits for watcher readiness before scanning all registered directories. A debounced watcher and a configurable periodic scan repair later external changes, including missed notifications. A tool mutation commits the filesystem first, updates metadata/FTS immediately when possible, and schedules embedding work. `objects_resync` is the explicit completion barrier when the next semantic query must include recent writes. The generic `FileWatcher`, `WatchLifecycle`, and `reconcileSnapshot` helpers own this scheduling and completeness policy under `src/lib/vault`.

An in-process Effect semaphore and a shared SQLite coordination lock serialize cooperative filesystem writes and metadata snapshots. The coordination file is `objects/.object-mcp-lock.sqlite`; it contains no object data. Lock acquisition retries asynchronously instead of blocking the event loop, and the OS releases a process's lock when that process exits. Model inference occurs outside the filesystem lock and outside search-index transactions.

Before publishing embeddings, reconciliation rereads the source checksum and atomically checks the corresponding metadata checksum. Changed text invalidates old vectors immediately. Model identity, dimensions, prefixes, window policy, and chunk settings participate in the cache fingerprint. Search uses only compatible, current vectors and rechecks returned files, omitting a hit that has changed or disappeared since indexing.

Important boundaries:

- Files and SQLite do not share an atomic transaction. A crash after a filesystem commit can leave search pending; the next rescan repairs derived state. A failure to update the cache after a successful file mutation is reported through status/error hooks without pretending the source write failed.
- External editors do not acquire the framework's coordination lock. Checksums detect ordinary stale edits, but an uncooperative editor can still race the final check and rename/unlink. This is optimistic concurrency, not a universal filesystem compare-and-swap primitive.
- Instances sharing a SQLite cache must use the same source root, registry snapshot, and compatible index configuration. Give different sources/registries their own cache paths. A registry change requires restarting instances together.
- Indexing is eventually consistent. Watch notifications are hints, and pending/invalid objects may be absent from search. Invalid source files are preserved and reported; duplicate identities are excluded together. An incomplete directory scan does not mass-delete unseen cache rows.
- Semantic distance evaluation is an exact scan of eligible vectors. This implementation does not promise approximate-nearest-neighbor indexing or corpus-scale latency. Tune chunk size and candidate count based on the actual workload.
- ONNX cancellation is cooperative. An active native inference call completes before disposal; cancellation prevents subsequent batches and discards the cancelled result. Resync is shared work: cancelling one waiter leaves other waiters' indexing alive.

The event subscription is a process-local notification mechanism. It is not a durable event log or job queue. Reconciliation provides recovery for derived indexing work.

## Configuration and verification

See [the library boundary](docs/library.md), [vault APIs](docs/vault.md), [the complete configuration reference](docs/configuration.md), [relaxed MCP parsing](docs/relaxed-json.md), [database abstractions](docs/database.md), [embedding behavior](docs/embeddings.md), [validation evidence](docs/validation.md), and [architecture decisions](docs/decisions/README.md).

```sh
bun run format
bun run biome:fix
bun run check
OBJECT_MCP_ONNX_TEST_CONFIG=object-mcp.config.json bun test
python3 scripts/smoke-stdio.py
```

`format` applies Biome formatting. `biome:fix` also applies safe lint fixes and organizes imports. The read-only `check` gate runs Biome, strict TypeScript, and the ordinary test suite. Biome is pinned to 2.5.15 in both lockfiles; the shared configuration uses two-space indentation, double quotes, semicolons, LF, and a 100-column width.

The ordinary tests use synthetic deterministic embeddings or mocked HTTP and do not download models or make paid API calls. The opt-in ONNX tests require a prepared local model and exercise real CPU inference, cross-language retrieval, and complete-file handling. The Python smoke test verifies real stdio pipes, CRUD/search, EOF shutdown, and recovery after killing a coordination-lock holder.

The repository contains source and lockfiles rather than a bundled executable. Native SQLite/ONNX dependencies and model assets remain external to the JavaScript module graph.
