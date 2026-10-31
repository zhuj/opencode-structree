---
id: framework-test
name: framework.test.ts
title: Framework Test
description: Exercises the framework facade for CRUD persistence, reconciliation of external edits, watching and embedding freshness.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-duplicate-ids
    - sc-framework-crud-file
    - sc-framework-concurrent-writers
    - sc-embedding-rebuild
    - sc-agent-tool-surface-sweep
    - sc-tool-surface-failure-codes
  commitsTo:
    - markdown-source-file
    - object-definition
    - sqlite-metadata-row
---
## File
test/framework.test.ts
## What it covers
CRUD persists exact schemas and separate body; unrestricted IDs cannot become paths | two concurrent writers cannot both consume the same checksum | external edits; rename; duplicate IDs; and malformed YAML reconcile without overwriting sources | watcher detects independent file edits and deletion | restart reuses unchanged vectors; provider fingerprint changes rebuild them | file changes during embedding reject stale work and index the new revision | embedding failure leaves fulltext usable and vectors pending | invalid subsets; empty subsets; disabled semantics; symlinks and invalid schemas are handled | a confirmed duplicate leaves search while an unrelated unseen object survives an incomplete scan | an empty type selector is rejected instead of selecting every registered type | list and search enforce their documented boundaries | onEvent reports every documented event kind and unsubscription stops delivery | requestResync drives a recovery pass without an explicit resync | a non-finite decoded number is rejected before it can reach the vault file | MCP creates a real file; returns ISO dates; searches it and closes cleanly | an explicit fulltext query and an empty type subset never invoke a failing provider and a disabled provider keeps both error codes | an encoder overflow is reported as INTERNAL rather than truncated | a real-file hit carries the excerpt while the body stays omitted | a changed or missing source rejects the whole hit with its excerpt and is not refilled | preparing the embeddings calls the provider once and records a preparation failure as the last error
## Verifies
markdown-frontmatter-round-trip, resync-index-reconciliation, partial-scan-preserves-cache, semantic-cosine-chunk-search, embedding-provider-failures, fulltext-excerpt, model-snapshot-prepared-at-startup
## Exercises
markdown-source-file, object-definition, sqlite-metadata-row