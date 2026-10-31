---
id: acceptance-fulltext-search-excerpts
name: "Acceptance: Fulltext Search Excerpts"
title: "Acceptance: Fulltext Search Excerpts"
description: A search hit carries bounded native evidence of why it matched, without changing the ranking or the semantic chunk.
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-21T00:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - fulltext-excerpt-shows-match-evidence
    - fulltext-excerpt-is-bounded
    - fulltext-excerpts-preserve-ranking-and-semantic-offsets
---
## Scenario
full-text-bm25-ranking - Full Text Bm25 Ranking
## Criteria covered
fulltext-excerpt-shows-match-evidence, fulltext-excerpt-is-bounded, fulltext-excerpts-preserve-ranking-and-semantic-offsets
## Evidence
test/sqlite.test.ts, test/search-abstraction.test.ts, test/framework.test.ts, test/mcp.test.ts, scripts/smoke-stdio.py