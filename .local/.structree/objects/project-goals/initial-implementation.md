---
id: initial-implementation
name: initial implementation
title: Initial implementation
description: "Deliver a working structree: a filesystem-authoritative object vault with a derived SQLite index, full-text and semantic search, an MCP tool surface for the twelve registered object families, a layered configuration system, and local state kept under .local/.structree/."
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:22:54.842Z
retiredAt: null
tags:
  status: active
metadata:
  commits: ed94d40,96a3f93,0d1a5d9
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/sqlite/process-lock.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
    - root: project
      path: docs/materialization.md
      role: documentation
relations:
  project: structree-initial
  partOf: null
---
# Initial implementation

## Outcome

An engineer can point the CLI at a source root and get a searchable, writable vault of
structured engineering objects, from the same process an agent or a human drives.

## In scope

1. Twelve registered object families stored as Markdown files in a source root.
2. A derived SQLite index with metadata, full-text rows and embedding rows.
3. Reconciliation that treats source files as authoritative and reports parse and
   embedding failures instead of hiding them.
4. An MCP server that exposes create, read, update, list, delete, search, status and
   resync for every family.
5. A configuration system with layered sources: built-in defaults, an optional
   `--config` file, and a local `config.yaml` override applied last.
6. Local state confined to `.local/.structree/`, outside version control.

## Out of scope

- Migrating objects between source roots.
- Multi-writer deployments beyond the single-process file lock.
- Shipping the ONNX model snapshot with the repository.

## Done when

The build produces a runnable bundle, the test suite is green, the server answers a
full CRUD round trip over stdio, and the object graph in this vault describes the
system it came from.

## Current Interpretation (2026-10-28)

This is the historical initial-delivery goal for [[projects/structree-initial|Structree]], not an expanded requirement inferred from later code. The original Done when text is an acceptance condition, not a report of checks run today. Current reusable storage coordinates cooperating writers through a shared SQLite process lock, so the historical single-process wording must not be read as a current lock limitation. The current configured local source data can be tracked by the repository; inspect actual ignore/tracking state rather than treating every local file as disposable. Later materialization/recovery feature records describe observed capabilities with empty goal commitments where no additional stakeholder goal was established. No tests or build were run during this refresh.

## Typed References

- [[projects/structree-initial|structree-initial]]

## Refresh Source Bindings

- implementation: `src/lib/sqlite/process-lock.ts`
- documentation: `docs/recovery.md`
- documentation: `docs/materialization.md`
