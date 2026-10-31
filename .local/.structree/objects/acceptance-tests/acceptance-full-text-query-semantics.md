---
id: acceptance-full-text-query-semantics
name: "Acceptance: Full Text Query Semantics"
title: "Acceptance: Full Text Query Semantics"
description: The lexical query semantics are implemented, tested and advertised.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - fts-query-tokens-are-literal-and-required
    - fts-type-filter-does-not-inject-type-text
---
## Scenario
full-text-bm25-ranking - Full Text Bm25 Ranking
## Criteria covered
fts-query-tokens-are-literal-and-required, fts-type-filter-does-not-inject-type-text
## Evidence
test/sqlite.test.ts, test/mcp.test.ts