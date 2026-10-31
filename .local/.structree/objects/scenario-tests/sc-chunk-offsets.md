---
id: sc-chunk-offsets
name: rejects malformed or source-mismatched chunks without replacing existing vectors
title: Mismatched Chunks Rejected
description: Shows that chunks disagreeing with their source offsets never replace existing vectors.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-stale-vector-rejection
  commitsTo:
    - sqlite-index-api
---
## Test
rejects malformed or source-mismatched chunks without replacing existing vectors
## File
test/sqlite.test.ts
## What it proves
Shows that chunks disagreeing with their source offsets never replace existing vectors.
## Criteria
chunk-zero-must-match-whole-file