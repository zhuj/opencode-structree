---
id: sqlite-metadata-row
name: SQLite Metadata Row
title: SQLite Metadata Row
description: The derived metadata projection of one object in the object_meta table.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - markdown-source-file
  usedBy:
    - index-rebuildable
    - sqlite-cache-ownership
    - stale-embeddings-invalidated
  usedIn:
    - sqlite-index-api
    - search-api
    - mcp-objects-status
    - mcp-objects-resync
  commitsTo:
    - adr-sqlite-search-index
    - adr-database-table-abstractions
---
## Fields
- object_key, object_type, id, name, title, path, checksum
- json, raw, body
- embedding_fingerprint, embedding_checksum, embedding_dimensions, embedding_chunks
## Lifecycle
Created or refreshed by a metadata upsert, invalidated when the source content changes, and removed when the source disappears or is deleted.
## Usage
Read by the index for search and status, and reconciled by the resync barrier.