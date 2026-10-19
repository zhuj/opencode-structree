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
