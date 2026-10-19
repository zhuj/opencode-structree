# Configuration reference

Configuration is validated by `FrameworkConfigSchema` in `src/lib/config.ts`. Partial configuration sections merge with the defaults. Unknown keys, null sections, invalid bounds, and unsupported provider/driver names fail before serving tools. JSON file paths resolve relative to the configuration file; `defineConfig(input, baseDirectory)` and `createFramework({baseDirectory,...})` provide the programmatic equivalent.

## Storage and server

| Field | Default | Meaning |
| --- | --- | --- |
| `root` | `objects` | Authoritative Markdown directory. Each registry definition selects a distinct relative subtree. |
| `sqlite.path` | `.object-mcp/index.sqlite` | Rebuildable search database. Must be outside `root`; `:memory:` is also accepted. |
| `sqlite.driver` | `better-sqlite3` | Native adapter; alternative `bun` uses `bun:sqlite`. |
| `sqlite.busyTimeoutMs` | `5000` | Search-index SQLite busy timeout. |
| `sqlite.extensionPath` | package-provided | Optional absolute or config-relative sqlite-vec extension path. |
| `sqlite.customSQLite` | unset | Optional custom SQLite dynamic library for the Bun adapter, selected before connections open. Particularly relevant to extension loading on macOS. |
| `server.name` | `object-mcp` | MCP server identity. |
| `server.version` | `0.1.0` | MCP server version. |

The coordination database has a fixed name under the source root so all framework instances operating on that root use the same lock. It contains an empty coordination table, no source objects. Do not delete it while any instance is running. The search index and model cache can be discarded after shutting down all instances; startup then rebuilds search from Markdown, and missing models need preparation again.

Both native adapters were tested on Linux x64. Custom macOS SQLite loading is supported by configuration and its initialization guard is tested, but that platform was not exercised in this workspace.

## MCP input repair

Generated tools use `mcp.inputRepair`. The input boundary checks bounded JSON data, attempts strict Effect validation first, and repairs only a failed input. Every candidate must pass the original strict codec before a handler runs. Output validation and the canonical JSON schemas advertised to clients remain strict.

| Field under `mcp.inputRepair` | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable schema-guided repair after strict input validation fails. False requires canonical arguments; resource and property-safety checks still apply. |
| `syntax` | `true` | Decode stringified JSON containers where an object/array is required, repairing supported syntax mistakes. Ordinary string fields remain unchanged. |
| `fuzzyKeys` | `true` | Enable bounded edit-distance matching of declared field names. Exact, case, and separator matching remain available when false. |
| `coerceTypes` | `true` | Convert finite numeric strings, conservative true/false strings, and case/separator variants of declared literals. Never rounds integers or guesses string IDs. |
| `inferWrappers` | `true` | Infer missing object/array containers and route uniquely identifiable fields across declared nesting. Required values must already have been supplied. |
| `splitArrays` | `false` | Explicitly allow comma, semicolon, or newline splitting with per-element trimming. Keep false when delimiters may belong to IDs. |
| `minConfidence` | `0.8` | Minimum heuristic score for edit-distance key matching, from 0 to 1. Does not suppress exact, case, or separator matching. |
| `maxKeyDistance` | `2` | Maximum edit distance, an integer from 0 to 3. Short or excessively long keys do not receive fuzzy edits. |
| `maxInputBytes` | `5000000` | Byte budget for parsed inputs' compact JSON representation, including string escaping. Text parsing also checks source/repaired text. Separate from the raw source-file size limit. |
| `maxDepth` | `32` | Maximum permitted input/repaired nesting depth; positive integer no greater than 128. |
| `maxNodes` | `50000` | Maximum input/repaired value nodes; positive safe integer. Routing also has a bounded work budget. |
| `maxRepairs` | `100` | Maximum repair notices for one candidate; positive safe integer. |

Partial nested sections merge with defaults. For example, this configuration disables all repair while retaining safety limits:

```json
{
  "mcp": {
    "inputRepair": { "enabled": false }
  }
}
```

The CLI applies the loaded configuration. Embedded `registerObjectTools(server, framework)` and `createMcpServer(framework, info)` inherit the framework's `config.mcp`; their optional third argument overrides individual repair options. A custom facade without configuration receives defaults. Example: `registerObjectTools(server, framework, {inputRepair: {maxRepairs: 25}})`.

Successful repairs are reported at `response._meta["object-mcp/input-repair"].repairs`. Unknown fields, conflicting destinations, ambiguous matches, and invalid final values fail before the facade runs. The parser does not fill missing required fields or repair outer JSON-RPC messages rejected by the SDK. See [the parser guide](relaxed-json.md) for full examples and the standalone Effect API.

## Synchronization and chunking

| Field | Default | Meaning |
| --- | --- | --- |
| `sync.watch` | `true` | Subscribe to relevant filesystem notifications. |
| `sync.confinement` | `auto` | Vault path handling: `auto` selects directory descriptors when Linux/procfs capabilities are available; `descriptor` requires those capabilities and fails initialization when unavailable; `portable` uses path and directory/file identity checks. |
| `sync.debounceMs` | `150` | Coalesce related notifications before reconciling. |
| `sync.rescanIntervalMs` | `60000` | Periodic reconciliation interval; zero disables it. |
| `sync.maxFileBytes` | `5000000` | Maximum raw UTF-8 object file size, enforced for reads and tool writes. |
| `sync.concurrency` | `2` | Maximum concurrent embedding workers. ONNX calls serialize inside their shared model provider. |
| `sync.lockTimeoutMs` | `10000` | Maximum asynchronous wait for the shared source coordination lock. |
| `chunking.size` | `1200` | Retrieval chunk size in Unicode code points. |
| `chunking.overlap` | `0.1` | Fraction of a full chunk repeated in the next chunk, rounded down to whole code points. |

Changing chunk size or overlap invalidates embedding freshness even when the source checksum is unchanged. Core object schemas do not contain configuration defaults; required domain fields must still be supplied.

## Search

| Field | Default | Meaning |
| --- | --- | --- |
| `search.defaultTopN` | `10` | Default maximum distinct objects. |
| `search.maxTopN` | `100` | Largest accepted tool request. |
| `search.candidateMultiplier` | `5` | Candidate pool size per method is `topN * multiplier` for hybrid fusion. |
| `search.rrfK` | `60` | Reciprocal rank fusion smoothing constant. |
| `search.fulltextWeight` | `1` | Full-text contribution to hybrid ranking. |
| `search.semanticWeight` | `1` | Semantic contribution to hybrid ranking. |
| `search.maxMatchCharacters` | `1200` | Maximum matching excerpt code points; whole body is returned only when explicitly requested. |

At least one weight must be positive. Default top-N cannot exceed the maximum. For an object present at rank `r`, a method contributes `weight / (rrfK + r)` to the hybrid score. A missing candidate contributes zero. Full-text-only and semantic-only modes retain their own ranking semantics.

## ONNX provider

Set `embeddings.provider` to `onnx`.

| Field | Default | Meaning |
| --- | --- | --- |
| `model` | `Xenova/multilingual-e5-small` | Pinned Hub encoder export or a local model directory. |
| `revision` | `761b726dd34fb83930e26aab4e9ac3899aa1fa78` | Immutable Hub commit. Local model directories are fingerprinted by file content. |
| `dimensions` | `384` | Required vector dimension. Inference output is validated. |
| `dtype` | `q8` | `q8`, `fp32`, `fp16`, or `q4`; matching ONNX files must exist. |
| `cacheDir` | `.object-mcp/models` | Directory for verified snapshots; must be outside source root. |
| `localFilesOnly` | `true` | Require a prepared snapshot. Set false only when explicitly permitting runtime model downloads. |
| `queryPrefix` | `query: ` | Prefix applied to query windows. |
| `documentPrefix` | `passage: ` | Prefix applied to document windows. |
| `maxTokens` | `512` | Configured context ceiling; actual tokenizer/model limits also apply. |
| `batchSize` | `8` | Maximum inference batch size. |

Run `bun scripts/prepare-model.ts --config path/to/config.json` to download and verify the configured model deliberately. For unusual model architectures, pooling conventions, or external tensor layouts, supply a local compatible export or implement `EmbeddingProvider` and inject it through `createFramework({embeddingProvider})`.

## OpenAI provider

Set `embeddings.provider` to `openai`. The provider selection chooses these defaults rather than retaining ONNX settings.

| Field | Default | Meaning |
| --- | --- | --- |
| `model` | `text-embedding-3-small` | Embedding model/deployment identifier. |
| `dimensions` | `1536` | Requested and validated output dimensions. |
| `baseUrl` | `https://api.openai.com/v1` | Embeddings endpoint base URL. Redirects are rejected. |
| `apiKeyEnv` | `OPENAI_API_KEY` | Environment variable read at request time. |
| `batchSize` | `32` | Maximum inputs per HTTP batch, also subject to provider limits. |
| `timeoutMs` | `30000` | Timeout per request attempt. |
| `retries` | `3` | Additional transient-error attempts. |
| `maxInputBytes` | `8000` | Conservative window byte budget, including prefix; implementation caps this at 8191. |
| `queryPrefix` | empty | Optional endpoint/model-specific prefix. |
| `documentPrefix` | empty | Optional endpoint/model-specific prefix. |

Provide the key through your host's secret/environment configuration, then start with `examples/openai.config.json`. It selects a separate cache file from the default ONNX example. API credentials never enter source Markdown or cache fingerprints.

Set `embeddings.provider` to `disabled` for metadata and full-text indexing only. An injected custom provider is owned by the framework and its `close()` is called at framework disposal. Its fingerprint must change whenever its output vector space or preprocessing changes.
