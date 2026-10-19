# Validation evidence

Latest verification: **2026-10-19**, Linux x64, Bun **1.4.3**. Direct dependencies are pinned in `package.json`; the package includes both `bun.lock` and `package-lock.json`.

## Current reusable library and vault update

| Check | Result |
| --- | --- |
| Biome 2.5.15, formatting/lint/import gate | **101 files checked; no diagnostics or fixes in the final read-only gate.** |
| Strict TypeScript with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` | Passed with TypeScript 7.0.2. |
| Complete ordinary suite via `bun run check` | **240 passed, 0 failed, 2 optional ONNX skips; 1,937 assertions across 22 files.** |
| Reusable import boundary and custom application | Every relative library import stays inside `src/lib`; public subpaths resolve; a Notes-only framework persists/searches through native SQLite and exposes nine MCP tools. |
| Generic vault | 20 real-filesystem tests, 97 assertions, covering independent Effect headers, byte/body preservation, strict parsing, expected checksums, publication ownership, confinement, partial discovery, cancellation, and draining. |
| Reusable watcher/reconciliation lifecycle | 17 tests, 74 assertions, including actual Chokidar notifications, readiness before scanning, shared callers, dirty completion races, shutdown/failure handling, and incomplete snapshots. |
| Reusable process lock | 9 tests, 43 assertions across better-sqlite3 and Bun SQLite, covering process/instance contention, FIFO ordering, failure release, cancellation, and draining close. |
| Integrated lifecycle | 10 tests, 66 assertions, including multiple cleanup failures, preserved startup cause, incomplete vault scans, and source deletion/rename during deferred embeddings. |
| Configuration | Three confinement modes accepted; invalid values rejected; existing partial settings receive `auto`. |
| Existing persistence, parser, MCP, search, and cache behavior | All ordinary regression suites passed, including the original v2 SQLite compatibility fixture and relaxed argument guards. |
| Real stdio CLI via ordinary OS pipes | All 64 tools, canonical CRUD/search, relaxed argument metadata, EOF shutdown, and crashed-lock recovery passed. |
| Dependency/lockfile consistency | Runtime/dev dependencies and both lockfiles are unchanged from the preceding package. Frozen Bun lockfile validation passed. |
| Architecture decision lint | 6 records checked; 0 errors and 0 warnings in strict mode. |

This update adds **56 tests and 301 assertions** to the preceding package. The
generic framework requires explicit registrations, while the root application
factory retains its 12 core defaults. The boundary test proves this distinction
at runtime as well as checking imports. The vault's unrelated Effect header
proves it can be used without the common object contract or an index database.

Publication tests cover stale writers, create conflicts, byte-tampered and
substituted stages, foreign/reused stages, replaced parent directories, file
permissions, UTF-8 byte limits, BOM/CRLF checksums, YAML constraints, symlink
exclusion, and exact trailing body whitespace. Unpaired UTF-16 is rejected in
raw bodies and paths before UTF-8 can change it; escaped header values remain
representable. Descriptor mode and forced portable mode were exercised on Linux.
Other operating systems and hostile concurrent namespace mutations were not
verified, and checksum guards remain cooperative optimistic concurrency.

The integrated deletion/rename tests hold embedding work open, modify the
filesystem with the watcher disabled, and require that the same resync barrier
converges on the new source state. A separate invalid-encoding test proves that
an unreadable source remains an explicit error instead of being treated as
absence. Cleanup fault tests prove all resource closures are attempted, with
startup and cleanup failures retained together when necessary.

The two optional ONNX tests were skipped because this run did not supply a
prepared local model. No model downloads or live paid embedding calls were
performed. Native FTS5/sqlite-vec tests ran with both SQLite drivers, and the
ordinary provider tests used deterministic embeddings or mocked HTTP. The
refactor does not change model fingerprints, cache layout, or the full-text and
semantic ranking policies. Earlier model evidence remains recorded below.

## Previous relaxed MCP parsing update

| Check | Result |
| --- | --- |
| Biome 2.5.15, formatting/lint/import gate | **79 files checked; no diagnostics or fixes.** |
| Strict TypeScript with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` | Passed with TypeScript 7.0.2. |
| Complete ordinary suite via `bun run check` | **184 passed, 0 failed, 2 optional ONNX skips; 1,636 assertions across 18 files.** |
| Real MCP request/response integration | Canonical schemas, mixed nested fields, missing wrappers, stringified containers, scalar options, strict outputs, and per-call reports passed. |
| Filesystem-backed repaired calls | Scenario create/search/update/delete passed against real Markdown/YAML and native SQLite FTS; rejected repairs and stale checksums preserved original source bytes. |
| Parser structure and safety review | Fragment-order permutations, ambiguous routes/unions, duplicate destinations, token preservation, reserved keys, proxies/getters/cycles, and cumulative resource limits passed. |
| Real stdio CLI via ordinary OS pipes | All 64 tools, canonical CRUD, repaired search/delete arguments, report metadata, EOF shutdown, and crashed-lock recovery passed. |
| Public Effect parser | Canonical JSON transforms, domain Dates, final refinement failures, and asynchronous Effect decoding passed. |
| Dependency/lockfile consistency | Only `jsonrepair` 3.15.0 was added to the npm package graph; existing package versions were retained. Frozen Bun lockfile validation passed. |
| Architecture decision lint | 5 records checked; 0 errors and 0 warnings in strict mode. |

This update adds 74 tests and 538 assertions to the previous ordinary suite. It
adapts the supplied parser at the actual generated-tool input boundary; domain
validation, source persistence, and tool output validation remain strict. The
new filesystem test verifies both accepted repairs reaching canonical source
files and rejected repairs leaving the original revision intact. Concurrent MCP
tests verify that repaired and canonical calls cannot exchange repair reports.

The syntax layer receives raw text only through the public text parser or
stringified containers within already decoded arguments. It cannot inspect
duplicate properties already collapsed by the MCP transport decoder. Functional
tests establish the described recovery rules and guards, not a measured model
recovery rate or a latency guarantee for an arbitrary schema/corpus.

The two optional ONNX tests were skipped because this run did not supply a
prepared local model. No live paid embedding requests or model downloads were
performed. Existing native SQLite, vector, filesystem, lifecycle, and mocked
provider tests all ran in the complete suite. Earlier model evidence is recorded
separately below.

## Previous database/table refactor

| Check | Result |
| --- | --- |
| Biome 2.5.15, read-only formatting/lint/import gate | **64 files checked; no diagnostics or fixes.** |
| Strict TypeScript with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` | Passed with TypeScript 7.0.2. |
| Complete ordinary suite via `bun run check` | **110 passed, 0 failed, 2 optional ONNX skips; 1,098 assertions across 12 files.** |
| New database/table tests | 21 passed, 158 assertions. |
| New FTS/vector/prepared-operation tests | 18 passed, 162 assertions. |
| New original-cache compatibility tests | 6 passed, 42 assertions. |
| Native SQLite and vector extension | Actual FTS5 and sqlite-vec passed through both better-sqlite3 and Bun SQLite. |
| Real stdio CLI via ordinary OS pipes | Passed initialization, all 64 tools, filesystem CRUD, full-text search, and EOF shutdown. |
| Forced termination of a coordination-lock holder | A fresh CLI resync reacquired the lock without deleting lock files. |
| Public SQLite export and plugin-cache example | Self-package import, Effect Date materialization, prepared upsert, and native FTS passed. |
| Frozen Bun lockfile validation | `bun install --lockfile-only --frozen-lockfile --ignore-scripts` passed. |
| Architecture decision lint | 4 records checked; 0 errors, 0 warnings in strict mode. |

The 45 new tests add 362 assertions to the previous ordinary suite. The native engine reports SQLite **3.53.4** and sqlite-vec **0.1.9**; the default driver is better-sqlite3 **13.0.3**. These integration checks use the loaded native libraries, not mocked database implementations.

The two optional ONNX tests were skipped because a prepared local model was not supplied for this refactor run. They remain opt-in, and the ordinary suite does not download weights or call paid APIs. Frozen lockfile validation checks manifest/lock consistency; this run did not repeat the earlier clean dependency-install experiment.

## What the checks establish

The compatibility fixture was captured independently from the original cache DDL before replacing the consolidated implementation. Tests populate that v2 schema with metadata, complete-file vectors, and a nonzero generation; reopening through the new abstractions preserves them. Missing and duplicate FTS rows are repaired, deletions remove the expected source row and vectors, and another reopen preserves the resulting state. Unrelated nonempty databases and unsupported cache versions are rejected without changing their data or schema.

The new database tests exercise Effect codecs for Dates, booleans, optional keys, nulls, and structured values; explicit and composite keys; bound predicates; empty/null membership; ordering and offset-only pagination. They verify that additive migrations retain extra columns and that incompatible changes roll back. Partial uniqueness, collations, conflicting key definitions, initialization failure, and driver-specific REGEXP capability have dedicated regressions.

The search abstraction tests exercise default names derived from concrete table classes, original FTS text, simultaneous key/text changes, repair of missing/duplicate/orphan FTS identities, and explicit failure for incompatible FTS columns or tokenizers. Semantic tests filter types, dimensions, fingerprints, and checksums before reducing chunks to distinct objects and applying top-N.

Prepared operations are tested with gated asynchronous providers and multiple database connections. Equal-valued intervening writes, delete/recreate cycles, key moves, and index-only repairs invalidate older revisions. A failing commit hook rolls back source rows, indexes, and revisions and can retry against the same unchanged snapshot. Aborting after preparation prevents commit. The public vector insertion helper rejects already stale input and source edits made while embeddings are pending. Every started legacy embedder call is drained before a failure returns, including when another callback throws synchronously.

The existing schema and MCP suites still cover all 12 concrete entities, required nullable keys, Date/ISO round trips, generated descriptions, custom definitions, host-tool preservation, validation before mutation, checksum errors, and cancellation reaching the facade.

Filesystem tests still use real temporary directories and cover atomic CRUD, independent writers consuming one checksum, external edits/renames/deletions, duplicate identities, malformed YAML preservation, symlink exclusion, restart reuse, provider changes/failures, and rejection of embeddings computed for an older source. Lifecycle tests verify lock-wait cancellation, shared resync ownership, and draining workers before closing the provider/database.

## Earlier model validation

The initial framework was verified on **2026-10-18** with a prepared multilingual E5 ONNX model: **67 passed, 0 failed, 778 assertions across 9 files**. A clean Bun dependency installation followed by the original `bun run check` passed **65 tests with 736 assertions**, with the same two model-dependent skips. Example seeding created all 12 entity files and preserved them on a second run.

That initial model preparation downloaded pinned E5 q8 assets, verified their file hashes, and completed native CPU inference. A pinned MiniLM q8 snapshot also passed offline inference. The opt-in tests cover cross-language MCP retrieval, type subsets, top-N, distinct objects, full-text/hybrid search, and content beyond the encoder's first context window. These are historical results for the initial build; the current refactor results are listed separately above.

## Reproduce

```sh
ONNXRUNTIME_NODE_INSTALL=skip bun install --frozen-lockfile
bun run check
python3 scripts/smoke-stdio.py

# Optional, with public model downloads during preparation:
bun run prepare-model
OBJECT_MCP_ONNX_TEST_CONFIG=object-mcp.config.json bun test
```

The Python script accepts `BUN_BIN` when Bun is installed at a nonstandard path. ONNX test mode requires an existing local snapshot and enforces local-only loading during the tests.

## Scope of the evidence

OpenAI HTTP behavior uses mocked responses to verify batching, complete Unicode coverage, response ordering, retries, permanent errors, malformed vectors, timeouts, cancellation, disposal, and missing credentials. Live paid requests were not made.

Both native adapters were exercised on Linux x64. Native custom SQLite loading on macOS and Windows deployment were not tested. The Bun custom-library selection guard has isolated tests.

These checks establish functional and integration behavior. They do not establish a corpus-scale latency target or retrieval quality on a labeled corpus. Exact vector scanning, character-based retrieval chunks, and whole-file aggregation retain the performance and quality trade-offs described in the architecture records.
