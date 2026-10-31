---
id: sc-semantic-freshness
name: source edits remove stale vectors atomically and reject late embedding publication
title: Stale Vectors Rejected
description: Shows that a source edit removes stale vectors and a late publication is refused.
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
    - acceptance-stale-vector-rejection
  commitsTo:
    - sqlite-index-api
---
## Test
source edits remove stale vectors atomically and reject late embedding publication
## File
test/sqlite.test.ts
## What it proves
Shows that a source edit removes stale vectors and a late publication is refused.
## Criteria
semantic-honors-freshness-constraints, stale-vector-publication-rejected