---
id: embedding-row
name: Embedding Row
title: Embedding Row
description: One stored chunk vector with its source offsets, checksum and fingerprint.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - sqlite-metadata-row
    - markdown-source-file
  usedBy:
    - embedding-fingerprint-invalidation
    - embedding-publication-guarded
    - stale-embeddings-invalidated
  usedIn:
    - sqlite-index-api
    - embedding-provider-factory
    - search-api
    - mcp-objects-status
    - framework-lifecycle-events
  commitsTo:
    - adr-sqlite-search-index
    - adr-embedding-windows
---
## Fields
- object_key, chunk_index, checksum, fingerprint
- dimensions, start_offset, end_offset
- chunk_text, vector
## Lifecycle
Replaced as a complete set when the source checksum and fingerprint still match, and cascade-deleted together with its metadata row.
## Usage
Computed by the embedding providers, published by the index and scanned by the semantic ranking path.