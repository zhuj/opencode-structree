---
status: accepted
date: "2026-10-19"
decision-makers: ["User"]
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0006. Extract the reusable library and adopt a generic Markdown vault

## Decision summary

Move reusable framework implementation into `src/lib` and introduce a typed
Markdown vault with separate filesystem ownership, header codecs, staging,
watcher lifecycle, and reconciliation policy. Keep the 12 concrete entity
schemas and their default registration outside the library. The generic
framework requires an explicit registry; the application factory retains its
existing core defaults.

This records the user's explicit request on 2026-10-19 to inspect and adopt the
supplied vault/storage ideas without their node/edge model, and to move abstract
layers, tools, utilities, and concepts into a reusable library. The exact module
layout, platform fallback, and API boundaries are implementation choices in
support of that direction.

## Context and problem statement

The prior implementation combines reusable filesystem operations and YAML
handling with object identity policy in FileStore. Its generic registry and
framework factory also import the application's concrete core definitions.
Copying storage or generated MCP tools into a similar project therefore carries
application schemas and hidden registration defaults along with them.

The supplied storage files demonstrate useful separation between a vault,
confined directories, owned publication stages, document codecs, watcher
lifetime, and reconciliation. Their higher-level facade also embeds node/edge
schemas, graph mutation services, database-authoritative projection recovery,
and SQLite-stamped read caching. Those policies do not follow from the general
vault abstraction and some conflict with this project's filesystem authority.

## Decision drivers

- Make the requested `src/lib` boundary easy to copy or consume independently.
- Keep Effect as the object schema and codec system.
- Preserve Markdown/YAML as the source of truth and SQLite as a rebuildable index.
- Support arbitrary frontmatter headers below the shared object contract.
- Retain checksum conflicts, duplicate-ID handling, strict source parsing, and
  deferred embedding freshness guarantees during the refactor.
- Make asynchronous work, publication stages, and resource ownership explicit.
- Preserve the application entry point and existing search/cache format.

## Considered options

1. **Move existing files mechanically into `src/lib`.** This is the smallest
   refactor and preserves current behavior, but leaves YAML/filesystem details
   tied to the common object contract and carries core defaults into generic
   imports. It does not fully provide the requested reusable vault concept.
2. **Extract a domain-independent vault and compose it through a generic object
   adapter**, selected. This separates file/codec ownership from `(type,id)`
   policy and makes watcher, process lock, and reconciliation helpers reusable.
   It requires additional module contracts and regression coverage at filesystem
   publication and shutdown boundaries.
3. **Port the supplied storage facade, recovery journal, and caches wholesale.**
   This preserves their original interdependent design, but introduces node/edge
   assumptions and a second authority policy. Adapting all of that machinery
   would be substantially larger than the requested vault reuse and would put
   external Markdown edits at risk of being replaced by database recovery.

## Decision outcome

`src/lib` owns common schemas/contracts, registry, configuration/errors, the
object facade, generated MCP tools, relaxed input parsing, chunking/providers,
database/table/search abstractions, and the new vault. Its internal import graph
has no dependency on application modules. Focused package exports expose `/lib`,
`/vault`, `/sqlite`, `/json-repair`, and `/embeddings`; the root export continues
to compose the core application, and `/schemas` exposes its concrete schemas.

`Vault<Header>` composes `ConfinedFilesystem` with `MarkdownCodec<Header>`. The
codec accepts injected decode/encode functions and preserves exact body text.
FileStore supplies Effect registry codecs and keeps deterministic file naming,
identity uniqueness, duplicate exclusion, and immutable ID/createdAt checks.
It captures a validated raw snapshot before awaiting identity discovery, then
publishes those exact bytes through the vault filesystem layer.

`ConfinedFilesystem` retains directory ownership, bounds reads, rejects invalid
UTF-8, excludes descendant symlinks, and validates logical paths. Owned stages
retain their parent and inode, verify identity and payload, publish new files
without clobbering existing destinations, preserve replacement permissions, and
clean up only their owned temporary name. Linux/procfs enables descriptor-based
paths; auto mode can fall back to portable path/identity checks. The root is a
trusted, canonicalized configuration boundary. Neither mode promises universal
protection against hostile namespace changes or compare-and-swap against an
arbitrary external editor.

`FileWatcher` and `WatchLifecycle` separate notifications from shared background
work. Readiness precedes the initial scan; events during a scan cause another
pass; concurrent resync callers share work. Cancelling one caller cancels its
wait only. Host shutdown first aborts actual work, then drains synchronization,
in-flight operations, runtime, provider, files, and databases. Cleanup attempts
all resources and retains startup and cleanup errors when both occur.

`reconcileSnapshot` separates valid discovery from derived index changes and
does not infer absence from an incomplete scan. Existing source checksum and
provider/chunk fingerprint checks protect deferred vector publication.
`SqliteProcessLock` extracts the existing dedicated SQLite coordination lock,
adds same-instance queuing, and remains independent of object schemas. The
coordination database contains no object/index state.

The existing metadata table already stores path, identity, and checksum. A
second checksum database and a SQLite-stamped TTL read cache are unnecessary:
external file edits can occur without any SQLite change stamp. Reconciliation
and source reads continue to observe current bytes. No database-authoritative
projection replay or node/edge policy is adopted.

## Consequences

### Positive

- Similar projects can reuse generic object tools without importing core entities.
- Arbitrary typed Markdown headers can use the vault without the common object
  schema, SQLite, MCP, or embedding providers.
- Staging, file lifecycle, process locking, watcher scheduling, and snapshot
  deletion rules each have focused contracts and real resource tests.
- The application still exposes 64 tools by default, and cache/source identities
  require no migration.
- Input repair and strict Effect validation continue to share the same generic
  generated-tool boundary for custom registries.

### Negative

- More explicit ownership creates more public contracts to maintain. Direct
  stage users must release their stage, and shared file owners must await close.
- Internal source import paths change. Direct `ObjectFramework.create()` callers
  must supply registrations; the root application factory keeps its defaults.
- Descriptor confinement relies on Linux/procfs. Portable mode has a wider race
  window and directory durability barriers are best effort when unsupported.
- The object framework still requires its common fields for CRUD/search. A fully
  arbitrary header can use Vault directly, but does not automatically gain an
  object identity/ranking policy.
- The reusable source still requires the declared external runtime/native
  dependencies. This change does not create a bundled executable or publish a
  new package.

## Confirmation

The library-boundary test resolves imports and rejects application dependencies,
checks public export targets, and starts a custom Notes-only framework. It
verifies nine generated tools, source persistence, native FTS, and absence of
core registrations. A separate vault suite uses an unrelated Effect header and
real temporary directories to test exact body/byte checksums, YAML constraints,
stale writers, no-clobber publication, inode/payload substitution, permissions,
symlinks, partial scans, Unicode encoding, and draining.

Watcher tests cover readiness, events during scanning/completion, coalesced
waiters, cancellation, bounded passes, failure recovery, shutdown, and actual
Chokidar notifications. Process-lock tests exercise both native SQLite drivers,
contention, queuing, cancellation, failure release, and draining close. Integrated
lifecycle tests verify cleanup failure handling and that incomplete vault scans
preserve unseen cached objects until discovery is complete.

The existing schema, repaired MCP, source CRUD, vector/cache compatibility,
provider, and stdio suites remain required verification gates. The current run
and optional model-test limits are recorded in validation evidence. Revisit this
boundary when another application's requirements expose a concrete dependency
on core types, when another platform is exercised, or when measured scan costs
justify a checksum-keyed parsed-document cache that still reads current bytes.

## Links

- [Reusable library guide](../library.md).
- [Vault adoption and API guide](../vault.md).
- [Generic library exports](../../src/lib/index.ts).
- [Vault implementation](../../src/lib/vault/vault.ts).
- [Object adapter](../../src/lib/filesystem.ts).
- [Shared process lock](../../src/lib/sqlite/process-lock.ts).
- [Generic framework composition](../../src/lib/framework.ts).
- [Library boundary test](../../test/library-boundary.test.ts).
- [Validation evidence](../validation.md).
- [Filesystem authority decision](0001-filesystem-commit-and-reconciliation.md).
- [Database/table decision](0004-adopt-database-table-abstractions.md).
- [Input repair decision](0005-repair-mcp-inputs-before-effect-validation.md).
