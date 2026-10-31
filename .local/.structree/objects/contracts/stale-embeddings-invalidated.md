---
id: stale-embeddings-invalidated
name: Stale Embeddings Are Invalidated
title: Stale Embeddings Are Invalidated
description: Vectors computed for an older revision of a file are discarded at once.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-sqlite-search-index
    - adr-embedding-windows
---
## Rule
When the source content of an object changes, the implementation MUST clear that object's stored embedding rows and its embedding freshness columns in the same commit as the metadata update.
## Evidence
src/lib/sqlite/index.ts:121-130
## Why it matters
A vector for older text would rank the object as if it still said the old thing.