---
id: sc-fts-bm25-order
name: full-text hits are ranked by BM25 rather than by insertion order
title: Fts Ranked By Bm25
description: Shows that full-text hits are ordered by BM25 score.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-full-text-bm25-ranking
  commitsTo:
    - sqlite-index-api
---
## Test
full-text hits are ranked by BM25 rather than by insertion order
## File
test/sqlite.test.ts
## What it proves
Shows that full-text hits are ordered by BM25 score.
## Criteria
fts-ranks-by-bm25