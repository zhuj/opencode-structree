---
id: fts-ranks-by-bm25
name: fts ranks by bm25
title: Rank full-text hits by bm25
description: A literal multi-token query returns hits ordered by BM25 score rather than by insertion order.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: full-text-bm25-ranking
  dependsOn: []
---
## Statement
Rank full-text hits by bm25: A literal multi-token query returns hits ordered by BM25 score rather than by insertion order.
## How it is observed
The returned hit order differs from the insertion order and equals the order of ascending BM25 scores.