---
id: semantic-cosine-chunk-search
name: semantic search
title: Semantic Cosine Chunk Search
description: Ranks objects by cosine distance over chunk embeddings and returns one reduced row per distinct object.
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
      - semantic-vector-search
---
## Context
Ranks objects by cosine distance over chunk embeddings and returns one reduced row per distinct object.

## Expected behaviour
A query embedding returns the nearest objects by cosine distance with one row per object.

## Failure modes
Vectors whose freshness markers disagree with the source row never enter the ranking.

## Covered by
semantic-ranks-by-cosine-distance, semantic-honors-freshness-constraints