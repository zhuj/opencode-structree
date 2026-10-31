---
id: adr-sqlite-search-index
name: SQLite search index
title: SQLite Search Index
description: The derived search cache stores metadata in ordinary SQLite tables with float32 embedding BLOBs, ranks semantic hits with the native sqlite-vec cosine distance function and lexical hits with FTS5 BM25, and restricts types and embedding freshness before ranking.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - full-text-bm25-ranking
      - semantic-cosine-chunk-search
      - cache-ownership-and-schema-version
  partOf: null
  dependsOn: []
---
## Context
The user required a filesystem-authoritative registry of Markdown objects with a rebuildable SQLite metadata and embedding cache, and top-N full-text, semantic or combined search over a subset of registered types, while the model, dimensions, source checksums and chunking configuration can all change. The open question was how the derived index should return the best matching objects, including selective searches. The record is dated 2026-10-18.

## Decision
The cache stores metadata in `object_meta` and float32 embedding BLOBs in `embeddings`, ranks semantic hits with the native `sqlite-vec` cosine distance function and lexical hits with FTS5 BM25, and applies type and embedding-freshness restrictions before ranking so that each object's best chunk is selected before the object limit is applied. The cache uses schema version 2. The record, dated 2026-10-18, is implemented but remains proposed with no maintainer approval or production performance target recorded.

## Consequences
- All eligible chunks are considered before document grouping and limiting, and a dimension change can coexist temporarily with older cached rows because freshness restrictions stop incompatible spaces from being compared.
- Semantic distance work grows with the eligible vector count times dimensions, and the cache duplicates source text across metadata, FTS and chunk rows.
- Hybrid fusion is limited to candidate pools of `topN * candidateMultiplier` objects, so an object with a moderate rank in both channels can be omitted.
- No throughput, latency or corpus-size guarantee is established, and a `vec0` virtual table layout stays the deferred next option to evaluate.

## Evidence
- `docs/decisions/0002-sqlite-search.md`
- `src/lib/sqlite/index.ts` and `src/lib/sqlite/driver.ts`, named as the implementation by the record
- `test/sqlite.test.ts`, recorded as 22 tests with 176 assertions on 2026-10-18 under Bun 1.4.3, better-sqlite3 13.0.3 and sqlite-vec 0.1.9