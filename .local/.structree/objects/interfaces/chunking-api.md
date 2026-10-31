---
id: chunking-api
name: Chunking API
title: Chunking API
description: Splits object text into retrieval chunks, embeds them, and derives the cache fingerprint.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - embedding-provider-interface
  usedBy:
    - checksum-covers-whole-file
    - embedding-fingerprint-invalidation
  commitsTo:
    - adr-embedding-windows
---
## Surface
src/lib/chunking.ts - chunkText, embedChunks and embeddingFingerprint.
## Behavior
Splits object text into retrieval chunks, embeds them, and derives the cache fingerprint.
## Guarantees
- Chunk offsets count Unicode code points so a boundary never splits a surrogate pair.
- Identical chunk text is embedded only once per indexing operation.
- The fingerprint covers the provider identity, the chunk size and the overlap.