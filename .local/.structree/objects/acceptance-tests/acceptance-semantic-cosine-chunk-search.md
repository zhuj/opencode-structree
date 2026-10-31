---
id: acceptance-semantic-cosine-chunk-search
name: semantic search acceptance
title: "Acceptance: Semantic Cosine Chunk Search"
description: The scenario semantic-cosine-chunk-search is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - semantic-ranks-by-cosine-distance
    - semantic-honors-freshness-constraints
---
## Scenario
semantic-cosine-chunk-search - Semantic Cosine Chunk Search
## Criteria covered
semantic-ranks-by-cosine-distance, semantic-honors-freshness-constraints
## Evidence
test/framework.test.ts, test/search-abstraction.test.ts, test/sqlite.test.ts