---
id: semantic-vector-search
name: semantic search
title: Semantic Vector Search
description: Ranks objects by sqlite-vec cosine distance over chunk embeddings constrained by checksum, fingerprint and dimension freshness.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
## What it does
Ranks objects by sqlite-vec cosine distance over chunk embeddings constrained by checksum, fingerprint and dimension freshness.

## Where it lives
src/lib/sqlite/vector-index.ts, src/lib/chunking.ts, src/lib/sqlite/prepared-mutation.ts

## Scenarios
semantic-cosine-chunk-search, stale-vector-rejection

## Verification
test/sqlite.test.ts; test/search-abstraction.test.ts; test/chunking.test.ts