---
id: full-text-search
name: full text search
title: Full Text Search
description: Ranks objects by BM25 over literal Unicode token queries with per-type filtering and exact match excerpts.
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
Ranks objects by BM25 over literal Unicode token queries with per-type filtering and exact match excerpts.

## Where it lives
src/lib/sqlite/fts-index.ts, src/lib/sqlite/filter.ts

## Scenarios
full-text-bm25-ranking

## Verification
test/sqlite.test.ts; test/search-abstraction.test.ts