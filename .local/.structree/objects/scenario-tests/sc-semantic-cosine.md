---
id: sc-semantic-cosine
name: vector filtering and whole/chunk reduction precede the document limit
title: Vector Reduction Before Limit
description: Shows that chunk rows are reduced to one row per object before the top-N limit applies.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-semantic-cosine-chunk-search
  commitsTo:
    - sqlite-index-api
---
## Test
vector filtering and whole/chunk reduction precede the document limit
## File
test/search-abstraction.test.ts
## What it proves
Shows that chunk rows are reduced to one row per object before the top-N limit applies.
## Criteria
semantic-ranks-by-cosine-distance