---
id: full-text-bm25-ranking
name: bm25 ranking
title: Full Text Bm25 Ranking
description: Ranks matching objects by BM25 score over literal Unicode tokens and applies the requested type subset.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - full-text-search
      - sqlite-index-and-search
---
## Context
Ranks matching objects by BM25 score over literal Unicode tokens and applies the requested type subset.

## Expected behaviour
A literal query returns matching objects ordered by BM25 score and restricted to the requested types.

## Failure modes
An empty token set returns no hits and an oversized token list is refused.

## Covered by
fts-ranks-by-bm25, fts-respects-type-filter