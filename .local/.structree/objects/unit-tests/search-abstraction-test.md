---
id: search-abstraction-test
name: search-abstraction.test.ts
title: Search Abstraction Test
description: Exercises the reusable FTS and vector index abstractions, ranking namespaces and prepared mutation revisions.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T00:50:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-semantic-cosine
  commitsTo:
    - full-text-row
    - embedding-row
    - sqlite-metadata-row
---
## File
test/search-abstraction.test.ts
## What it covers
lazy default names and trigger updates preserve original text and one row per identity | FTS initialization repairs identities and rejects incompatible columns or tokenizers | manual extractors are synchronized by ordinary Table CRUD without escaping persisted text | vector filtering and whole/chunk reduction precede the document limit | prepared mutations await providers outside SQL and atomically publish; retry; and repair indexes | persistent revisions reject a prepare after another connection writes equal source values | public vector insertion rejects stale input and concurrent source changes | cancellation after preparation prevents the deferred commit from changing source or indexes | FTS ranking metadata never overwrites a colliding source column | FTS ranking ignores a retained source column named like the internal score alias | FTS initialization refuses a pre-existing index with a different content model | vector ranking metadata never overwrites a colliding source column | direct vector insertion publishes the configured freshness markers | revision identity follows the collation of the source key column | a revision table written with binary comparison migrates to the source collation | embedding adapter preserves provider purpose/cancellation without taking ownership | legacy embedder preparation drains started calls when one callback throws synchronously | the search method that returns an excerpt and the one that does not agree on identities; raw scores; filters; limits and ordering | the excerpt alias cannot be shadowed by a source or retained column and stays current through trigger maintenance
## Verifies
full-text-bm25-ranking, semantic-cosine-chunk-search, stale-vector-rejection, fulltext-excerpt
## Exercises
full-text-row, embedding-row, sqlite-metadata-row