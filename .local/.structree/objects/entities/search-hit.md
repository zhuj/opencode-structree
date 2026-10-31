---
id: search-hit
name: Search Hit
title: Search Hit
description: One ranked match returned for a query.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:24:32.236Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/types.ts
      role: implementation
    - root: project
      path: src/lib/source-access/search.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn:
    - full-text-row
    - embedding-row
  usedBy:
    - search-hits-revalidated
    - search-bounds-enforced
  usedIn:
    - search-api
    - sqlite-index-api
    - mcp-objects-search
  commitsTo:
    - adr-flat-search-namespace
    - adr-sqlite-search-index
    - adr-fulltext-search-excerpts
---
## Fields
- type, id, name, title, path, checksum
- score, fulltextRank, semanticDistance
- matchedChunk, body
- fulltextExcerpt: an optional string or null holding bounded lexical evidence, with no coordinates and no column attribution

## Lifecycle
Produced per query, reduced to distinct objects, sorted by score, truncated to topN and revalidated against the current source file before it is returned. A rejected hit is discarded with its excerpt, and the excerpt never causes an extra read.

## Usage
Returned by the search API and the objects_search tool. The concrete index always emits the excerpt; a producer that omits it stays valid, and its absence means no excerpt was supplied rather than that no lexical match exists.

## Current Variants (2026-10-28)

`src/lib/types.ts` separates IndexedSearchResponse from SourceSearchResponse; both carry the SearchHit union of complete or explicitly partial hits. Source fallback hits have null fulltextRank, semanticDistance, matchedChunk and fulltextExcerpt; the surrounding response has mode:source, requestedMode, null indexGeneration and coverage/recovery information. Partial indexed/source hits retain recovered metadata, identity provenance and issues, not a complete validated domain object. Neither variant promises a whole-source raw field. includeBody controls body only; indexed lexical excerpts may disclose content without it. See [[interfaces/source-access-runtime-api|Source access]].

## Typed References

- [[entities/full-text-row|full-text-row]]
- [[entities/embedding-row|embedding-row]]
- [[contracts/search-hits-revalidated|search-hits-revalidated]]
- [[contracts/search-bounds-enforced|search-bounds-enforced]]
- [[interfaces/search-api|search-api]]
- [[interfaces/sqlite-index-api|sqlite-index-api]]
- [[interfaces/mcp-objects-search|mcp-objects-search]]
- [[adrs/adr-flat-search-namespace|adr-flat-search-namespace]]
- [[adrs/adr-sqlite-search-index|adr-sqlite-search-index]]
- [[adrs/adr-fulltext-search-excerpts|adr-fulltext-search-excerpts]]

## Refresh Source Bindings

- implementation: `src/lib/types.ts`
- implementation: `src/lib/source-access/search.ts`
- documentation: `docs/recovery.md`
