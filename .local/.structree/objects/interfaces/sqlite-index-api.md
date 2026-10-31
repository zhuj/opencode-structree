---
id: sqlite-index-api
name: SQLite Index API
title: SQLite Index API
description: Owns the derived cache that backs metadata, full-text and vector search.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T00:45:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - sqlite-table-api
  usedBy:
    - index-rebuildable
    - duplicate-identity-excluded
    - incomplete-scan-no-deletion
    - confirmed-conflict-invalidates
    - delete-removes-derived-data
    - stale-embeddings-invalidated
    - embedding-publication-guarded
    - embedding-fingerprint-invalidation
    - cache-outside-source-root
    - search-hits-revalidated
    - sqlite-cache-ownership
  commitsTo:
    - adr-sqlite-search-index
    - adr-database-table-abstractions
    - adr-fulltext-search-excerpts
---
## Surface
src/lib/sqlite/index.ts - the SqliteIndex class.

## Behavior
Owns the derived cache that backs metadata, full-text and vector search, and can return the bounded lexical excerpt in the same statement that evaluates the match and the score.

## Guarantees
- No method writes to a Markdown source file.
- An embedding set is published only while the stored checksum still matches.
- A metadata update and the invalidation of stale vectors share one commit.
- The search method that returns an excerpt shares its validation, match, filter, ranking, projection, ordering and limit with the search method that does not, so both return the same identities, scores and order.
- The excerpt is extracted by the search engine from the matching indexed column, under a fixed token budget, and a source column cannot shadow it.