# Object MCP

A Bun/TypeScript framework that turns an **Effect-schema object registry** into MCP CRUD tools and searchable Markdown objects. The filesystem is authoritative. SQLite contains derived metadata, FTS5 data, and `sqlite-vec` embedding rows that can be rebuilt from the files.

The package includes the 12 requested schemas, a standalone stdio server, and a facade that can attach tools to an existing plugin server. It has no application-level Zod schemas. Effect defines the domain, persistence codecs, configuration validation, and MCP JSON schemas; Effect also owns the runtime and in-process serialization.

The SQLite cache uses the supplied `Database`, `Table`, `IndexedTable`, FTS, vector, and prepared-mutation abstractions, adapted to Effect and the existing cache format. Biome provides formatting, recommended lint checks, and import organization.

Generated MCP tools include the supplied relaxed JSON parser's mechanisms adapted to Effect. They repair unambiguous field spelling, misplaced nesting, stringified containers, and selected scalar representations, then require the original strict schema to validate the complete arguments before a handler runs. Canonical tool schemas and outputs remain strict. See [relaxed JSON and MCP arguments](docs/relaxed-json.md).

All reusable implementation now lives in **`src/lib`**, with no imports of the core application schemas. The generic `/lib` entry point takes explicit registrations; the root entry point preserves the 12 built-in defaults. The supplied vault/storage concepts are implemented as a typed Markdown vault, confined filesystem, owned publication stages, watcher lifecycle, reconciliation helpers, and a reusable SQLite process lock. See [reusing the library](docs/library.md) and [vault design and APIs](docs/vault.md).

## Quick start

For a full-text-only OpenCode setup without model downloads or example seeding, use [Build and OpenCode V2](#build-and-opencode-v2).

Requirements: Bun **1.4.3 or later** and a platform supported by the native SQLite/ONNX packages. The implementation was verified on Linux x64 with the exact versions in the lockfiles. Model weights are downloaded separately.

```sh
ONNXRUNTIME_NODE_INSTALL=skip bun install --frozen-lockfile
bun run check
bun run seed-example
bun start
```

`ONNXRUNTIME_NODE_INSTALL=skip` skips the optional ONNX GPU download; the CPU runtime is bundled in the dependency. `embeddings.device` selects the execution provider: `cpu` is the default and always available, while `cuda` needs the CUDA 12 runtime libraries present for the installed onnxruntime-node build. The CLI prepares the local ONNX provider for `serve` and `sync`: with the built-in `embeddings.localFilesOnly: false` default, a missing pinned snapshot is fetched at startup. A complete snapshot is reused by preparation without a network request. Preparation fetches files, not a loaded model; inference still loads the model lazily when needed. `seed-example` creates one example of each entity; existing example IDs are left intact.

Set `embeddings.localFilesOnly: true` to retain offline-only operation: a missing snapshot reports `MODEL_NOT_CACHED` without fetching anything. The diagnostic explains startup fetching when the switch is false and otherwise names `bun scripts/prepare-model.ts --config <your-config.json>` for manual preparation. The optional `bun run prepare-model` command downloads and verifies the pinned assets and runs a synthetic inference check; it is not a prerequisite for normal startup. A preparation failure is reported but does not stop the server: full-text search remains available, while semantic/hybrid requests retain their existing provider-error behavior. See [embedding preparation and errors](docs/embeddings.md#local-onnx) and [decision 0010](docs/decisions/0010-prepare-the-model-snapshot-at-startup.md).

`seed-example` writes those twelve examples into the configured source root, which is `.local/.structree/objects` inside this repository for the included configuration. That directory sits under the ignored `.local/` path, so the seeded objects are authoritative source data that stays out of `git status`. They remain ordinary source files on disk: the framework reads, updates, and deletes them like any other object.

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

The included JSON configuration is complete. Relative paths resolve from its directory, so the MCP client's working directory does not alter the data location that file selects. The optional local override file `.local/.structree/config.yaml` is read from the working directory and applied last; see [storage layout and local overrides](#storage-layout-and-local-overrides).

`--config` is optional. Without it the CLI uses the built-in defaults: the source root `.local/.structree/objects`, the derived index `.local/.structree/.cache/index.sqlite`, and the local ONNX provider, all relative to the working directory the command runs in.

```json
{
  "mcpServers": {
    "objects": {
      "command": "bun",
      "args": ["/absolute/path/object-mcp/src/cli.ts", "serve"]
    }
  }
}
```

The optional `.local/.structree/config.yaml` override is read from the same working directory, so a project can run the server with no configuration file at all.

For a first run using full-text search only:

```sh
bun src/cli.ts serve --config examples/fulltext.config.json
```

To inspect or rebuild the derived index without starting a transport:

```sh
bun src/cli.ts sync --config object-mcp.config.json
bun src/cli.ts status --config object-mcp.config.json
```

Both commands accept the same optional `--config` file; without it they report on the built-in default layout.

The MCP server starts the watcher and first reconciliation during framework creation but no longer waits for that pass before answering requests. A search issued while the index is being built may find nothing; `objects_status` reports `syncing: true` and `lastSync: null` until a completed report exists. Create indexes its own object immediately, so create followed by search still works while existing files await discovery. A deferred startup failure is reported through the framework's error channel without stopping the server. Reconciliation is the repair path, not a read-only call: it can rename a discovered file to match its id. These renames can happen after the server starts answering. See [decision 0015](docs/decisions/0015-defer-the-startup-reconciliation.md).

Both diagnostic commands still wait for startup reconciliation, so their JSON reports describe a completed pass. Only `sync` calls `prepareEmbeddings()`; `status` does not prepare the provider. The report itself is read-only, but either command's startup reconciliation can rename source files. They exit with code `2` when the reconciliation reports source or embedding issues. The `status` command prints the same report as the `objects_status` tool, and the `sync` command prints the last synchronization report; both bound their issue list to 50 entries and add the totals and the per-code counts described under [the tools](#the-12-schemas-and-their-tools). Library creation still waits by default; only a caller that explicitly sets `waitForStartup: false` defers the first pass.

## Build and OpenCode V2

From the repository root, with Bun **1.4.3 or later**:

```sh
ONNXRUNTIME_NODE_INSTALL=skip bun install --frozen-lockfile
bun run build
bun dist/cli.js --help
```

The build bundles application code into `dist/cli.js` for Bun, leaving packages external. This is a JavaScript bundle, **not a standalone native executable**: keep `node_modules/` installed and Bun on the PATH available to OpenCode. Generated `dist/` files are ignored by Git.

The project-local `.opencode/opencode.json` registers `mcp.servers.structree` for OpenCode V2. It runs `bun dist/cli.js serve --config examples/fulltext.config.json` with `cwd: "."`, which OpenCode resolves from the workspace root, not the `.opencode/` directory. No global configuration or permission grants are needed by this file.

This configuration disables embeddings and uses full-text search only. It does not seed objects or download models; neither `prepare-model` nor `seed-example` is needed. Application paths resolve relative to `examples/fulltext.config.json`: `.local/.structree/objects` at the repository root holds authoritative Markdown data, while `.local/.structree/.cache/index.sqlite` is the ignored, rebuildable derived index. Objects created through MCP are real source files, not disposable cache data.

Open or reload this repository as an OpenCode V2 project, then use `/mcps` to find `structree` and check its connection status. After source edits, run `bun run build` again and reconnect the server or reload the project to use the updated bundle. OpenCode does not build it automatically.

## Storage layout and local overrides

The default project layout keeps authoritative sources, the derived search index, and local configuration under `.local/.structree/` in the project root:

| Path | Role |
| --- | --- |
| `.local/.structree/objects` | Authoritative Markdown source root. Each registry definition selects a distinct relative subtree below it. |
| `.local/.structree/.cache/index.sqlite` | Rebuildable search database with object metadata, FTS5 data, and `sqlite-vec` embedding rows. |
| `.local/.structree/objects/.object-mcp-lock.sqlite` | Shared coordination lock for every instance using that source root. It holds no object data. |
| `.local/.structree/config.yaml` | Optional local override file, read automatically when it exists. |

`.local/` is ignored by Git, so the object data and the derived index no longer appear as untracked files in `git status`.

Verified ONNX snapshots live outside the project by default. `embeddings.cacheDir` is `~/.cache/onnx/models`, or `$XDG_CACHE_HOME/onnx/models` when `XDG_CACHE_HOME` is an absolute path; a relative value of that environment variable is ignored. Every project on the machine using this user cache shares the snapshot at `<cacheDir>/<model>/<revision>`. An explicit `cacheDir` still overrides the default, and the cache must remain outside the object directory. See [configuration](docs/configuration.md#onnx-provider) and [decision 0014](docs/decisions/0014-keep-model-snapshots-in-the-user-cache.md).

Changing the configuration never moves existing objects: a source root is selected by configuration, and objects stay where they were written. The repository previously held a legacy `objects/` directory and a legacy `.object-mcp/` index; neither is used by the current configuration, and no migration code exists to move one to the other.

### Local override file

`.local/.structree/config.yaml` is an optional local override. The CLI reads it automatically whenever it exists; no flag selects it. It is a YAML document with the same key structure as the JSON configuration, and it is applied as the last layer: the values it sets replace the built-in defaults and the values of any `--config` file, while its partial sections merge with the layer below.

Path values in this file resolve against the project root, which is the directory the command runs in. Relative paths inside a JSON `--config` file keep their own rule and resolve against that file's own directory.

The file is ignored by Git with the rest of `.local/`, so it stays local to the working copy. Because it is applied last, it also applies to the server started through `.opencode/opencode.json`. A local `embeddings` section that names a provider replaces the disabled provider of `examples/fulltext.config.json`. A section without `provider` keeps the provider of the layer below it, and a disabled provider owns no model or dimension values, so those values are dropped.

```yaml
embeddings:
  provider: onnx
  model: Xenova/multilingual-e5-base
  revision: "<commit that pins the selected export>"
  dimensions: 768
```

`revision` must pin the same export as `model`; a local model directory replaces both. The CLI prepares the selected snapshot at startup for `serve` and `sync`, fetching missing files when `embeddings.localFilesOnly` is false (the built-in default). Set it to true to refuse downloads and require a pre-existing snapshot. The model identity participates in the cache fingerprint, so changing it invalidates the cached vectors of the affected objects. Because this file is ignored by Git, a literal `embeddings.apiKey` belongs here and not in a tracked configuration file.

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
  config: { root: ".local/.structree/objects" },
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

The example sets the source root explicitly. Programmatic path values resolve against `baseDirectory`, so omitting `config` selects the built-in default, `.local/.structree/objects`, under the same base directory.

Alternatively, `createMcpServer(objects, info)` constructs the server for you. Closing one MCP server/transport does not close the shared facade; the host owns `objects.close()`. The standalone CLI connects cleanup to its actual stdio transport and process signals.

Both registration functions inherit `objects.config.mcp`. An optional third argument overrides input repair settings, for example `registerObjectTools(server, objects, {inputRepair: {enabled: false}})` to require canonical arguments. The default enables bounded repair and preserves explicit required values, object IDs, timestamps, and checksum guards.

`examples/plugin.ts` is a typechecked embedding example. A host can use the official SDK's HTTP handler with the same `createMcpServer` factory; create the shared framework outside the per-connection factory. HTTP hosting and authentication belong to that host.

### Public facade

| Method | Contract |
| --- | --- |
| `create(type, object, body?, signal?)` | Validate a complete object and create its Markdown file. |
| `get(type, id, signal?)` | Read the current filesystem document, including recoverable content and diagnostics when its frontmatter is incomplete. |
| `update(type, id, object, body, expectedChecksum, signal?)` | Replace the complete object/body, preserving ID and `createdAt`. |
| `delete(type, id, expectedChecksum, signal?)` | Delete the source file and invalidate its derived search data. |
| `list(type, {limit?, offset?}, signal?)` | Read filesystem documents in ID order, including partial documents; default limit 50, maximum 1,000. |
| `search(request, signal?)` | Retrieve distinct objects from the synchronized index; `topN` is capped by the configured `search.maxTopN`. |
| `resync(signal?)` | Wait for shared reconciliation and report every issue. |
| `prepareEmbeddings(signal?)` | Explicitly call the provider's optional `prepare`; record a failure as the last error and rethrow it. Embedding library hosts decide whether to call it; framework creation does not prepare automatically. |
| `requestResync()` | Schedule a coalesced background reconciliation. |
| `status()` | Report index and synchronization state, embedding metadata, pending work, and bounded known issues with totals and per-code counts, without testing provider readiness. |
| `onEvent(listener)` | Subscribe to tool mutations, filesystem notifications, and completed sync reports. Returns an unsubscribe function. |
| `close()` | Cancel pending work, drain active work, and release watcher, model, runtime, and database resources. |

Facade inputs accept domain `Date` objects or the canonical JSON representation. MCP inputs/outputs and YAML dates are ISO strings. A validated stored response is `{type, object, body, path, checksum}`. Get/list return `ReadObject`, a union of validated and partial results; narrow with `if (document.partial)` before using complete schema fields. A list response with `includeBody: false` omits `body` and, for partial results, `raw` as well.

### Reading incomplete documents

Existing Markdown does not need to satisfy a complete object schema to be read or
indexed. Missing frontmatter, malformed YAML, and missing required fields produce
a partial result with recoverable metadata, content, and validation diagnostics
rather than hiding the whole document. The registered directory determines type;
a usable frontmatter `id` takes precedence, otherwise the filename stem supplies
an explicitly inferred read/search identity. That identity is not written back to
the file, and missing dates, relations, and other domain fields are not invented.

Readable partial text is eligible for full-text and configured semantic indexing.
Get/list results distinguish partial documents from validated objects; use the
content and diagnostics to inspect them rather than treating inferred metadata
as a valid object. A missing or unterminated frontmatter block does not discard
the readable source. Scanning and resync do not repair or rename partial files.

A partial get result is `{partial: true, type, object, body, path, checksum,
raw, identity, issues}`. `object` contains recovered JSON-compatible fields plus
the resolved `id`; `identity` is `{source: "frontmatter" | "filename", id, type}`;
each issue is `{code, message}`. Partial fields are not decoded domain values:
for example, a recovered date stays a string, not a fabricated `Date`. Partial
search hits include `partial`, `object`, `identity`, and `issues`, but no dedicated
`raw` field; their name/title fallbacks are derived display labels.

Create and update still require complete, schema-valid objects. Tolerant reading
does not waive checksum conflicts, duplicate-identity ambiguity, bounded file
size, UTF-8 validation, filesystem confinement, or real I/O failures. Reads do
not rewrite the source or change its ownership or permissions.

Update/delete of a partial source returns `SOURCE_CONFLICT`, even when it has an
explicit id and a current checksum. Repair its source explicitly before mutation.

## The 12 schemas and their tools

Every registration produces `_create`, `_get`, `_update`, `_delete`, and `_list` tools. The built-in registry therefore exposes **60 entity tools plus five shared tools**, for **65 tools** total.

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

The shared tools are `objects_search`, `objects_relations`, `objects_resync`, `objects_status`, and `objects_definitions`. The last returns JSON schemas derived from the Effect definitions, including descriptions and required keys.

`objects_definitions` takes an optional `type` argument. Without it, it returns every registered type; with it, only that one; an unknown type fails with the `UNKNOWN_TYPE` error. Its output also carries a `guidance` array that states the object model and the intended workflow once. Its naming guidance is:

> Object ids are stable, unique within their type, and are the only handle: the file name is the id, an id is always lowercase, and the scanner renames a file whose name does not match its id.

The remaining guidance states that `get` answers a known id, update and delete replace the whole revision and need the checksum from the latest get, list, create or update, the timestamps are supplied by the caller while the id and `createdAt` are immutable, relation targets are not validated as described below, `description` is a one-line summary and the body is the Markdown content, and search is not exhaustive. Every per-type tool description ends with "See objects_definitions for the object model and workflow."

The generated input schemas state the limits the runtime enforces. The list `limit` is an integer from 1 to 1000 and defaults to 50, the list `offset` is 0 or more and defaults to 0, and the search `topN` is an integer from 1 to the configured `search.maxTopN`, which is 100 by default, and defaults to the configured `search.defaultTopN`, which is 10 by default. Each per-type list tool takes an optional `includeBody` boolean that defaults to true; with it false the returned objects carry identity, title, path and checksum only, which is the cheap way to discover the contents of a type.

`objects_status` publishes this description:

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

Its issue list is bounded to the first 50 entries and carries `issuesTotal`, `issuesTruncated` and `issuesByCode`, a count per issue code. `embeddings.provider` is the configured label; fingerprint and dimensions are metadata, not an inference outcome. Resync is not a prerequisite for a read-only investigation.

The domain schemas preserve all required fields from the supplied specification. Nullable fields require explicit `null`; canonical objects include every required array and nested commitment struct. `Feature` has no `partOf`; there is no `belongsTo` or separate `Acceptance` entity. See [the field and relationship reference](docs/core-schemas.md).

Schema validation checks shape and the [portable stored-id domain](docs/core-schemas.md#shared-fields) with `VALIDATION` before any target is considered. A caller may send an id in any case: at the very start of create, get, update and delete, the framework lowercases the object id and every relation identifier below the tool boundary, then checks the lowercased form against the domain. A create with `MyThing` stores `mything`; a get with `MyThing` finds it. A valid identifier naming a nonexistent target is still stored after normalization. Validation does not check reference existence, inverse relationships, duplicate reference IDs, or dependency/hierarchy cycles. The filesystem layer separately needs one unambiguous `(type,id)` to address a stored object. Conflicting files with the same identity are reported and excluded from indexing; identical ID strings in different registered types are allowed. Within a type, ids differing only in case are one id, so a second create fails with `ALREADY_EXISTS` on every filesystem.

## The relation graph

`objects_relations` answers the two questions a graph-shaped vault raises:
what a change reaches, and what justifies a change. It reads the Markdown
sources, so the answer reflects the vault on disk rather than the derived
search index.

The two modes answer two different questions, so the tool classifies every
relation field into a kind that decides how a change propagates:

| Kind | Fields | A change to the target reaches the holder | A change to the holder reaches the target |
| --- | --- | --- | --- |
| `depends` | `dependsOn` | yes | no |
| `justifies` | `commitsTo`, `commitment.scenarios`, `commitment.features`, `commitment.goals` | yes | no |
| `uses` | `usedBy`, `usedIn` | no | yes |
| `contains` | `partOf` | yes | no |
| `owns` | `project`, `scenario` | yes | no |
| `relates` | `relatesTo` | no | no |

A `uses` relation is stored on the provider, so it is the only kind whose
impact runs along the stored edge rather than against it. The `neighbors` mode
returns relation edges up to the requested depth, with `direction` selecting
how the walk follows each stored edge: `outgoing` from source to target,
`incoming` from target to source, and `both` either way. An edge keeps the
direction of the walk that first reached it, so its label stays stable as depth
increases. The `impact` mode returns the
objects a change to the root reaches, at a `depth` of up to ten hops, and
defaults to the `depends`, `uses` and `justifies` kinds.

Because the framework stores relation targets as written and never checks
them, the response also reports the link defects: `DANGLING_TARGET`,
`TARGET_TYPE_MISMATCH`, `AMBIGUOUS_TARGET` and `CYCLE`. A type mismatch does
not drop the link, so the blast radius stays complete, but it is reported
because the object does not mean what the field declares. A target that names
no object is not an object, so it is not in the answer set, while its edge and
its finding still report the broken link. Readable partial sources participate
using only safely recovered, descriptor-shaped relation values. Their warnings
are returned as `issues` with `complete: false`; missing fields do not imply a
complete graph. Unreadable, conflicting or duplicated sources still prevent a
reliable graph, so the query is refused rather than returning a misleading answer.

The [proposal](docs/impact-analysis-proposal.md) records the design, the
traversal semantics and the verified behaviour.

## Using structree from an agent

The project skill at `.opencode/skills/structree` teaches an agent how to work with this surface: when the vault is the right source rather than the code, how to search before listing, how the checksum and the caller-owned timestamps constrain a write, how to keep a listing small, and what every relation field means. OpenCode discovers it automatically in this repository, and it points at `objects_definitions` as the authority on the schema of the server it is talking to.

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

All timestamps are caller-supplied. An update is a full replacement, including its body; it is not a deep partial patch. The framework keeps `id` and `createdAt` immutable and requires the current checksum on update/delete. Set `retiredAt` explicitly when retirement is desired; delete performs an actual file deletion. A retired object remains listed and searchable; callers exclude it by checking `retiredAt`. This publishes existing listing and search behavior, not a behavior change.

For validated objects, the file name is the id: a created object is stored at `<type directory>/<id>.md`. During reconciliation, the scanner renames a validated file whose base name is not `<id>.md`, in its existing directory, and updates the indexed path. File content is the source of truth, so a hand-renamed validated file is renamed back to match its id. Partial documents are never automatically renamed. Subdirectories remain supported because only the base name is corrected. A filesystem that folds case or normalizes names may spell the name differently while the target still names the same file. The scanner accepts that spelling, leaves the file unchanged and indexed at its actual path, and reports no issue. A rename never overwrites: only a different file holding the target name is a conflict, excluding the object with `RENAME_CONFLICT` and leaving both files unchanged. A resync can therefore rename validated files and is not read-only. Changing an object's `name` does not rename its file. See [decision 0013](docs/decisions/0013-name-the-file-after-the-id.md).

Creating a new ID requires its type directory to have no invalid or conflicting source files, so the store can establish that the identity is unused. Existing valid objects can still be read, updated, or deleted while other files are being repaired.

YAML is parsed as version 1.2 with duplicate-key diagnostics and bounded alias expansion. Strict writes reject unknown object fields and non-JSON metadata values rather than silently discarding them. Tolerant reads omit ambiguous or unsafe recovered values and report issues. The domain `metadata` schema remains `Record<string, any>`; storage cannot represent functions, cyclic values, class instances, `undefined`, or nonfinite numbers faithfully. All required domain fields must be present on writes and validated objects, but not on partial reads.

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
| `fulltext` | SQLite FTS5 BM25 over names, titles, and complete raw files, using the literal-token semantics below. |
| `semantic` | Exact cosine distance through `sqlite-vec`; the best matching whole-file/chunk vector determines each object's rank. |
| `hybrid` | Weighted reciprocal rank fusion of the document-level full-text and semantic candidate lists. |

The tool's exact query, type-filter and mode descriptions are:

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.

The search tool itself states:

> Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking, including readable partial documents. Missing or malformed frontmatter does not by itself exclude a document; partial hits expose recovered fields, identity origin and issues. Display label fallbacks are derived, not validated source facts. Search is not exhaustive: topN is a maximum, recent objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate readable objects. The server's startup reconciliation runs in the background, so a search issued right after it starts may find nothing; objects_status reports whether a synchronization is still running. The body field is omitted unless includeBody is true; search never returns a dedicated raw field. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

Identical extracted strings are deduplicated before folding; case variants can count separately against the 128-token limit. Overflow currently surfaces as `INTERNAL`, not `VALIDATION`. Two words can match anywhere, not necessarily as a phrase. `reconcil*` searches the token `reconcil`, and `cafe` matches `café`. Hybrid still invokes its provider before lexical evaluation. A provider failure keeps the `EMBEDDINGS_UNAVAILABLE` code and its cause, and its message ends with `Search with mode "fulltext" to query without embeddings.` Embedding failures during indexing leave full-text search available and mark affected objects pending. A configured provider or a snapshot's presence does not guarantee lazy model loading succeeds.

The 128-token cap bounds the generated FTS5 MATCH expression; it is self-imposed, not a SQLite limit, and fails rather than truncates. Shorten an over-limit query yourself. On 2026-10-21 SQLite 3.53.4 executed 2000 AND-joined and 5000 OR-joined terms without error. See [decision 0011](docs/decisions/0011-publish-the-observed-surface-and-reject-empty-identifiers.md). Hybrid hits from a query with no lexical tokens have `fulltextRank: null` and a set `semanticDistance`.

The `types` parameter is published as an enum of the registered type names, so an unknown name is rejected by input validation with the full list in the message, before the call reaches the framework. A name that reaches the framework anyway fails with the `UNKNOWN_TYPE` code and carries `registeredTypes`, the sorted registered type names, in its error details. Multiple chunks never consume multiple positions in the final object result. Only a complete successful paginated source listing can support an absence claim about readable, uniquely identified objects; search revalidation is not a guarantee against subsequent edits.

Results include type, ID, name/title, source path/checksum, score, full-text rank, semantic distance, and nullable semantic `matchedChunk`. Fulltext hits have no semantic chunk. `includeBody` adds the full body. Semantic chunk text is capped by `search.maxMatchCharacters`; its `[start,end)` offsets refer to the raw source file in Unicode code points. A score is a ranking value, not a probability. Hybrid fusion examines `topN * candidateMultiplier` candidates per method, so increasing this setting can change the fused result order.

Results also allow optional `fulltextExcerpt: string | null`. The concrete index
always emits a string when a lexical match is present, including hybrid hits
with zero lexical fusion weight, and null otherwise, including semantic-only
hybrid candidates. Older servers or custom facades may omit it; absence means no
excerpt was supplied. Automatic selection from name/title/raw text uses a fixed
32-FTS-token budget, followed by the first `search.maxMatchCharacters` Unicode
code points (1200 by default), including native `...` markers without splitting
surrogate pairs. This evidence carries no coordinates or column attribution and
does not change `matchedChunk`. It is discovery evidence, not a complete match
explanation: every AND term need not appear, and a small cap or long token may
clip the visible match. Treat source markup as text, not sanitized HTML.
`includeBody` governs only the `body` property. The whole hit and its excerpt
are discarded on checksum rejection without refill or extra per-hit reads;
revalidation does not guarantee future freshness. See
[decision 0009](docs/decisions/0009-fulltext-search-excerpts.md).

SQLite stores:

| Derived data | Identity/content |
| --- | --- |
| `object_meta` | `type:id` key with the id JSON-encoded only when needed, ID, type, path, checksum, canonical object JSON, raw file, body, embedding freshness metadata. |
| `object_fts` | FTS5 search projection synchronized with object metadata. |
| `embeddings` | Primary key `(object_key, chunk_index)`, float32 embedding, source text, code-point offsets; joined to object checksum and active model/chunk fingerprint. |
| Index state/issues | Generation and last reconciliation issues. |

The cache key joins the type and id with a colon, for example `project:structree-initial`. The type must not contain a colon; registered type names are snake_case and never contain one, while the public `objectKey` function throws `TypeError` for a type containing a colon. The id is used verbatim unless it contains a colon, a double quote, a backslash, a control character (U+0000 to U+001F), or an unpaired UTF-16 surrogate; then the id part is `JSON.stringify(id)`. A plain id part never contains a quote, so a leading double quote identifies a JSON-encoded id part and the pair is recoverable by splitting on the first colon. The framework never decodes the key: it reads the type from `object_type` and the exact id from `json`, because SQLite's UTF-8 TEXT binding normalizes an unpaired surrogate to U+FFFD while JSON preserves it. See [decision 0012](docs/decisions/0012-use-a-type-id-cache-key.md).

Embedding index `0` represents the **whole raw file, including frontmatter**. Positive indices cover the full file in 1,200-code-point chunks by default, with 120-code-point overlap: **10%**, a 1,080-code-point step. The last chunk includes the end of the file.

For text beyond a model's context window, the provider processes every internal window and normalizes their weighted mean. This whole-file vector is an approximation that covers all source content. It is not equivalent to unlimited-context attention. Retrieval chunks retain more local meaning. See [embedding details](docs/embeddings.md).

The default provider uses local ONNX CPU inference with a pinned multilingual E5 model, 384 dimensions, q8 weights, and its query/passage prefixes. `embeddings.device` selects the execution provider: `cpu`, the default and always available, or `cuda`, which needs the CUDA 12 runtime libraries present for the installed onnxruntime-node build and reports the `DEVICE_UNAVAILABLE` error code when the backend cannot be initialized. The device participates in the cache fingerprint, so changing it invalidates the cached vectors of the affected objects.

The OpenAI provider supports endpoint/model/dimensions configuration, batching, timeouts, retries, cancellation, and credentials. An external OpenAI API compatible provider is selected with `embeddings.baseUrl`; the request is posted to `<baseUrl>/embeddings` and omits the `dimensions` field for every model outside the `text-embedding-3` family, because such a server may reject that field. Credentials come from the environment variable named by `embeddings.apiKeyEnv`; an empty name sends the request without an `Authorization` header, and a named but unset variable fails with the `API_KEY_MISSING` error code. A literal `embeddings.apiKey` is accepted as well: prefer `apiKeyEnv`, and keep a literal key only in the git-ignored local file `.local/.structree/config.yaml`, never in a tracked configuration file. A literal key is never written to the fingerprint, to an error message, or to any file. Use `examples/openai.config.json` to select the provider. Object text and queries are sent to that configured endpoint when this provider is selected. The source package contains no API key.

## Database and table extension API

The `@local/object-mcp/sqlite` export exposes `Database`, `Table`, `IndexedTable`, `Column`, `Filter`, `Migrator`, `FTSIndex`, `VectorIndex`, prepared mutations, and `SqliteProcessLock`. `columnsFromEffect(schema)` derives validated SQLite converters from Effect's canonical JSON codecs. `examples/database.ts` demonstrates a typed plugin cache with optional provider injection.

The framework uses these classes for metadata, chunk rows, generation state, and reconciliation issues. Tables support custom and composite primary keys; embedding rows retain the `(object_key, chunk_index)` shape. The new key encoding bumps the cache schema from version 2 to 3. Replace the derived cache file rather than migrate it; the next sync rebuilds the index and re-embeds the corpus when embeddings are enabled. A stale cache file is refused with "use a fresh cache file and resync the Markdown sources". The table migrator is additive only and refuses a changed primary key without dropping columns or inventing values. Prepared indexed operations compute embeddings before a short, revision-guarded SQL commit.

See [the database guide](docs/database.md) for the supplied-file mapping, API examples, migration rules, cancellation, driver capabilities, and transaction boundaries.

## Synchronization, locks, and lifecycle

Startup waits for watcher readiness before scanning all registered directories. A debounced watcher and a configurable periodic scan repair later external changes, including missed notifications. A tool mutation commits the filesystem first, updates metadata/FTS immediately when possible, and schedules embedding work. `objects_resync` is the explicit completion barrier when the next semantic query must include recent writes. The generic `FileWatcher`, `WatchLifecycle`, and `reconcileSnapshot` helpers own this scheduling and completeness policy under `src/lib/vault`.

An in-process Effect semaphore and a shared SQLite coordination lock serialize cooperative filesystem writes and metadata snapshots. The coordination file is `.object-mcp-lock.sqlite` inside the source root, so with the default layout it is `.local/.structree/objects/.object-mcp-lock.sqlite`; it contains no object data. Lock acquisition retries asynchronously instead of blocking the event loop, and the OS releases a process's lock when that process exits. Model inference occurs outside the filesystem lock and outside search-index transactions.

Before publishing embeddings, reconciliation rereads the source checksum and atomically checks the corresponding metadata checksum. Changed text invalidates old vectors immediately. Model identity, dimensions, prefixes, window policy, and chunk settings participate in the cache fingerprint. Search uses only compatible, current vectors and rechecks returned files, omitting a hit that has changed or disappeared since indexing.

Important boundaries:

- Files and SQLite do not share an atomic transaction. A crash after a filesystem commit can leave search pending; the next rescan repairs derived state. A failure to update the cache after a successful file mutation is reported through status/error hooks without pretending the source write failed.
- External editors do not acquire the framework's coordination lock. Checksums detect ordinary stale edits, but an uncooperative editor can still race the final check and rename/unlink. This is optimistic concurrency, not a universal filesystem compare-and-swap primitive.
- Instances sharing a SQLite cache must use the same source root, registry snapshot, and compatible index configuration. Give different sources/registries their own cache paths. A registry change requires restarting instances together.
- Indexing is eventually consistent. Watch notifications are hints, and pending or unreadable documents may be absent from search. Readable files with incomplete frontmatter are indexed as partial documents without rewriting them; duplicate identities are excluded together. An incomplete directory scan does not mass-delete unseen cache rows.
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
```

`format` applies Biome formatting. `biome:fix` also applies safe lint fixes and organizes imports. The read-only `check` gate runs Biome, strict TypeScript, the ordinary test suite, and the stdio smoke test. Biome is pinned to 2.5.15 in both lockfiles; the shared configuration uses two-space indentation, double quotes, semicolons, LF, and a 100-column width.

The smoke test is a Python 3 script, so `bun run check` needs `python3` on the PATH; `bun run smoke` runs that script on its own. It verifies real stdio pipes, CRUD/search, EOF shutdown, and recovery after killing a coordination-lock holder. `bun run smoke:build` builds first, then runs the same suite against `dist/cli.js` in a temporary isolated vault, without touching repository objects or downloading models. `OBJECT_MCP_CLI` overrides the smoke entry point; it defaults to `src/cli.ts`, so ordinary `smoke` and `check` runs remain source-based and do not build.

The ordinary tests use synthetic deterministic embeddings or mocked HTTP and do not download models or make paid API calls. The opt-in ONNX tests require a prepared local model and exercise real CPU inference, cross-language retrieval, and complete-file handling. The shipped CLI's argument, help, status, and exit-code contracts are asserted by `test/cli.test.ts`, which drives the CLI as a subprocess and observes its exit code and JSON output.

The repository tracks source and lockfiles, not generated bundles or standalone native executables. `bun run build` produces the ignored JavaScript bundle described above; package dependencies, native SQLite/ONNX libraries, and any model assets remain external.
