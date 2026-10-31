---
id: sc-fts-type-filter
name: loads the real sqlite-vec extension and FTS5, literal Unicode queries respect type filters
title: Fts Respects Type Filters
description: Shows that a literal Unicode query honours the requested type subset.
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
loads the real sqlite-vec extension and FTS5; literal Unicode queries respect type filters
## File
test/sqlite.test.ts
## What it proves
Shows that a literal Unicode query honours the requested type subset.
## Criteria
fts-respects-type-filter