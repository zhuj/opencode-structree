---
id: embedding-publication-guarded
name: Embedding Publication Is Guarded
title: Embedding Publication Is Guarded
description: Embeddings are published only while they still describe the current file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - stale-embeddings-invalidated
  commitsTo:
    - adr-sqlite-search-index
    - adr-embedding-windows
---
## Rule
Before publishing vectors the implementation MUST re-read the source, verify its checksum still equals the checksum the vectors were computed from, and MUST discard the vectors instead of publishing them when it does not.
## Evidence
src/lib/framework.ts:370-383; src/lib/sqlite/index.ts:139-176
## Why it matters
Embedding is slow, so the file can change while the vectors are computed.