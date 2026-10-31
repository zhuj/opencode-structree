---
id: search-api
name: Search API
title: Search API
description: Retrieves distinct matching objects from the synchronized, rebuildable index.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:22:55.144Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/framework.ts
      role: implementation
    - root: project
      path: src/lib/sqlite/index.ts
      role: implementation
    - root: project
      path: src/lib/source-access/search-operation.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn:
    - sqlite-index-api
  usedBy:
    - search-hits-revalidated
    - search-bounds-enforced
  commitsTo:
    - adr-flat-search-namespace
    - adr-sqlite-search-index
    - adr-search-query-and-availability-guidance
    - adr-fulltext-search-excerpts
---
## Surface
src/lib/framework.ts search and src/lib/sqlite/index.ts search.

## Behavior
Retrieves distinct matching objects from the synchronized, rebuildable index, evaluating the lexical component under the recorded query semantics and returning the bounded lexical excerpt with each hit.

## Guarantees
- Results are distinct objects rather than chunks or rows.
- The hybrid score is the weighted sum of the two reciprocal-rank contributions.
- Every hit is revalidated against the current source file before it is returned, and a rejected hit is dropped without a refill.
- The lexical evaluation follows the fulltext-query-semantics contract, and the provider is not consulted on the explicit fulltext path.
- A hit with a lexical match carries the bounded excerpt, a hit without one carries null, and the semantic chunk keeps its own coordinates.

## Boundary Clarification (2026-10-28)

The ranked/revalidated behavior above describes direct ObjectFramework and SqliteIndex, not every ObjectFacade. The normal server composes [[interfaces/source-access-runtime-api|Source access]] and may return explicitly labeled mode:source with requestedMode, null ranks/generation and incomplete-coverage diagnostics. That is not BM25/semantic success or a silently renamed result. The indexed API retains its provider failures; the wrapper applies its own bounded degraded path. See `src/lib/source-access/search-operation.ts` and `docs/recovery.md`. No tests were run during this refresh.

## Typed References

- [[interfaces/sqlite-index-api|sqlite-index-api]]
- [[contracts/search-hits-revalidated|search-hits-revalidated]]
- [[contracts/search-bounds-enforced|search-bounds-enforced]]
- [[adrs/adr-flat-search-namespace|adr-flat-search-namespace]]
- [[adrs/adr-sqlite-search-index|adr-sqlite-search-index]]
- [[adrs/adr-search-query-and-availability-guidance|adr-search-query-and-availability-guidance]]
- [[adrs/adr-fulltext-search-excerpts|adr-fulltext-search-excerpts]]

## Refresh Source Bindings

- implementation: `src/lib/framework.ts`
- implementation: `src/lib/sqlite/index.ts`
- implementation: `src/lib/source-access/search-operation.ts`
- documentation: `docs/recovery.md`
