---
status: proposed
date: "2026-10-18"
decision-makers: []
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0001. Commit files first and reconcile derived search state

## Decision summary

Commit validated Markdown mutations to the filesystem, update metadata/FTS immediately when possible, and reconcile embeddings asynchronously from source snapshots. Provide an explicit resync barrier and startup/watcher/periodic recovery. This realizes the user's required filesystem source of truth while accepting eventual search freshness and avoiding a remote embedding request in every write's critical section.

The implementation is complete; this record remains proposed because no separate stakeholder review of these synchronization details has occurred.

## Context and problem statement

The user requires generated CRUD tools, local editor changes, SQLite metadata/vector caches, startup resynchronization, and filesystem notifications. A file may be changed without passing through the MCP process. Model inference may be slow or unavailable, and the file plus SQLite cannot participate in one atomic transaction.

The decision is how to define write success and synchronize derived data. The domain schema relationships and embedding ranking strategy are outside this decision; see [the schema reference](../core-schemas.md) and [ADR 0002](0002-sqlite-search.md).

## Decision drivers

Hard constraints are Markdown/YAML source authority, exact Effect domain schemas, external file editing, and rebuildable SQLite. Evaluation criteria are source integrity, clear mutation outcomes, recovery after a crash, useful operation while models are unavailable, and predictable plugin shutdown.

## Considered options

1. **Synchronous write-through:** publish the file, then require metadata and embeddings to finish before a mutation responds.
2. **Filesystem commit plus reconciliation:** report the committed file, publish cheap metadata immediately, and let owned background work synchronize embeddings with an explicit barrier when needed.

Making SQLite authoritative would violate the user-supplied storage constraint and is not a viable alternative here.

## Decision outcome

Choose filesystem commit plus reconciliation. Create/update responses identify the source revision using its SHA-256 checksum. Mutation success means the source mutation completed. Cache failures enter status/error reporting and are repaired by reconciliation. A model outage therefore does not turn a successful file write into an ambiguous failed tool response.

The framework serializes source mutations and metadata snapshots using an Effect semaphore and a dedicated SQLite coordination database shared by root directory. The latter holds only an OS-backed transaction lock and an empty coordination table. Its acquisition retries asynchronously with a timeout, avoiding synchronous busy-wait deadlocks between instances sharing one event loop. A process crash releases its OS lock without PID-file reclamation races.

Search-index transactions remain synchronous and short. Filesystem I/O and model inference never run inside those index transactions. The separate coordination transaction intentionally spans the filesystem critical section because it is only a lock, not the index's data transaction. Model inference happens outside both locks. Completed vectors must still match the source checksum and current metadata checksum before publication.

## Consequences

Positive effects: files remain usable without a database; failed embeddings do not block metadata/FTS; startup and periodic scans repair missed notifications; checksum guards reject cooperating stale writers; closing the framework drains actual work before disposing native resources.

Negative effects: search is eventually consistent; an immediate semantic query can miss a just-created object until `resync` completes. Global source scans and per-root serialization favor straightforward correctness over large-workspace throughput. A dedicated coordination SQLite file is an additional housekeeping artifact.

An external editor does not share the coordination lock. The final checksum check narrows races but cannot create a universal filesystem compare-and-swap against arbitrary editors. Callers must not infer stronger guarantees. Instances sharing an index must agree on source root and registry; different sources need different caches.

Source parse errors preserve the file and exclude it from indexed results. Duplicate `(type,id)` files are all excluded. An incomplete directory enumeration must not mass-delete unseen cached rows. Search checks the source checksum of returned hits, so an obsolete indexed record is omitted during a race.

## Confirmation and review triggers

`test/framework.test.ts` covers actual Markdown CRUD, duplicate/invalid files, external edits/renames/deletions, watcher behavior, cache reuse, failed provider recovery, and file changes during embedding. `test/lifecycle.test.ts` covers independent instances consuming one checksum, cancellation while waiting for coordination, shared resync waiters, and shutdown with an active slow inference worker. `scripts/smoke-stdio.py` verifies CLI EOF behavior and successful resync after forcibly killing a lock holder.

These tests passed during implementation on Linux x64 with Bun 1.4.3. Revisit this decision if scan latency becomes material, multiple roots require one cache, durable user jobs/events are introduced, or atomic cooperation with an external editor becomes a requirement. No corpus-size latency target or stakeholder acceptance has been supplied.

## Option analysis

Synchronous write-through gives a convenient per-request search barrier under healthy dependencies. It also couples mutation latency and error reporting to model availability, while still failing to make the file and database atomic or to cover external edits. It would still need the reconciliation machinery for repair.

Filesystem commit plus reconciliation explicitly separates the durable action from derived readiness. It keeps writes useful during provider failures and permits batching/coalescing. Callers pay the cost of an explicit barrier where freshness matters. The barrier and owned task lifetime make that cost visible rather than hiding detached promises.

## Links

- Requirements and public contract: [README](../../README.md)
- Implementation: [framework](../../src/lib/framework.ts), [filesystem](../../src/lib/filesystem.ts)
- SQLite isolation and transaction locking: <https://www.sqlite.org/isolation.html>
- SQLite atomic commit: <https://www.sqlite.org/atomiccommit.html>
- Node filesystem watcher caveats: <https://nodejs.org/api/fs.html#caveats>
