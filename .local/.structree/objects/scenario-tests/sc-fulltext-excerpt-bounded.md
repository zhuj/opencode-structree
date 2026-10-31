---
id: sc-fulltext-excerpt-bounded
name: Sc Fulltext Excerpt Bounded
title: Sc Fulltext Excerpt Bounded
description: Shows that the excerpt is bounded evidence and that the bound is a size limit rather than redaction.
createdAt: 2026-10-21T00:40:00.000Z
updatedAt: 2026-10-22T00:00:00.000Z
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
the excerpt obeys the configured code-point cap, an astral character is not split and a short document can be disclosed whole
## File
test/sqlite.test.ts, test/search-abstraction.test.ts
## What it proves
Shows that the excerpt is bounded evidence and that the bound is a size limit rather than redaction.
## Criteria
fulltext-excerpt-is-bounded