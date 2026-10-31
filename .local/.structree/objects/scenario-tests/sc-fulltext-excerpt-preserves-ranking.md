---
id: sc-fulltext-excerpt-preserves-ranking
name: Sc Fulltext Excerpt Preserves Ranking
title: Sc Fulltext Excerpt Preserves Ranking
description: Shows that adding the excerpt changed nothing about the ranking or the semantic coordinates.
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-fulltext-search-excerpts
  commitsTo:
    - sqlite-index-api
    - search-api
---
## Test
the old and the new search methods return identical identities, scores, ordering, filters and limits, and the semantic chunk is unchanged
## File
test/search-abstraction.test.ts, test/sqlite.test.ts, test/mcp.test.ts
## What it proves
Shows that adding the excerpt changed nothing about the ranking or the semantic coordinates.
## Criteria
fulltext-excerpts-preserve-ranking-and-semantic-offsets