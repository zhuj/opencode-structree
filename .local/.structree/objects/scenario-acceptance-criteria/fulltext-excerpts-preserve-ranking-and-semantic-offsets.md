---
id: fulltext-excerpts-preserve-ranking-and-semantic-offsets
name: Fulltext Excerpts Preserve Ranking And Semantic Offsets
title: Fulltext Excerpts Preserve Ranking And Semantic Offsets
description: Fulltext excerpts preserve ranking and semantic offsets
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: full-text-bm25-ranking
  dependsOn:
    - fulltext-excerpt-is-bounded
---
## Statement
Fulltext excerpts preserve ranking and semantic offsets: The identities, scores, ordering, filters and limits are identical to a search without an excerpt, and the semantic chunk keeps its own coordinates.
## How it is observed
The old and the new search methods return identical source rows, identities, raw scores, filtering, limits and ordering, and a semantic-only hit keeps a null excerpt with its chunk unchanged.