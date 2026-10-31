---
id: acceptance-full-text-bm25-ranking
name: bm25 ranking acceptance
title: "Acceptance: Full Text Bm25 Ranking"
description: The scenario full-text-bm25-ranking is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - fts-ranks-by-bm25
    - fts-respects-type-filter
---
## Scenario
full-text-bm25-ranking - Full Text Bm25 Ranking
## Criteria covered
fts-ranks-by-bm25, fts-respects-type-filter
## Evidence
test/sqlite.test.ts