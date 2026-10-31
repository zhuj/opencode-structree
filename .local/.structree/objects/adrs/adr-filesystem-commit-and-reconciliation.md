---
id: adr-filesystem-commit-and-reconciliation
name: Filesystem commit and reconciliation
title: Filesystem Commit And Reconciliation
description: Validated Markdown mutations are committed to the filesystem as the source of truth, and derived SQLite metadata and embeddings are reconciled asynchronously behind an explicit resync barrier.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - markdown-frontmatter-round-trip
      - resync-index-reconciliation
      - partial-scan-preserves-cache
  partOf: null
  dependsOn: []
---
## Context
The framework had to serve generated CRUD tools, local editor changes, SQLite metadata and vector caches, startup resynchronization and filesystem notifications at the same time, and a file can change without passing through the MCP process. Model inference may be slow or unavailable, and the Markdown file and its SQLite cache cannot join one atomic transaction, so a decision was needed on what counts as a successful write and how derived data is synchronized. The record is dated 2026-10-18 and lists the drivers as source integrity, clear mutation outcomes and recovery after a crash.

## Decision
The framework commits validated Markdown mutations to the filesystem, updates metadata and FTS immediately when possible, and reconciles embeddings asynchronously from source snapshots, exposing an explicit resync barrier plus startup, watcher and periodic recovery. Create and update responses identify the source revision by its SHA-256 checksum, and a mutation succeeds when the source mutation completed. The record is dated 2026-10-18, is implemented, and remains proposed with no decision-maker recorded.

## Consequences
- Files stay usable without a database, and a failed embedding no longer blocks metadata or FTS, so a model outage cannot turn a committed write into an ambiguous tool failure.
- Search becomes eventually consistent: a semantic query issued right after a create can miss the object until resync completes.
- Source mutations and metadata snapshots are serialized with an Effect semaphore and a dedicated SQLite coordination lock, which adds a housekeeping artifact and favours correctness over large-workspace throughput.
- An external editor does not share that lock, so checksum guards narrow races but cannot provide a universal filesystem compare-and-swap.

## Evidence
- `docs/decisions/0001-filesystem-commit-and-reconciliation.md`
- `src/lib/framework.ts` and `src/lib/filesystem.ts`, named as the implementation by the record
- `test/framework.test.ts`, `test/lifecycle.test.ts` and `scripts/smoke-stdio.py`, named as the confirmation by the record