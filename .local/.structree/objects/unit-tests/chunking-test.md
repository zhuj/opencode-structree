---
id: chunking-test
name: chunking.test.ts
title: Chunking Test
description: Verifies code-point chunking, overlap rounding and single-embedding reuse for identical chunk text.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo: []
  commitsTo:
    - embedding-row
    - embedding-fingerprint
    - sqlite-metadata-row
---
## File
test/chunking.test.ts
## What it covers
row zero holds the complete raw file; positive chunks cover every code point with 10% overlap | fractional overlap rounds down and terminal chunks do not repeat the same endpoint | rejects non-progressing or invalid chunk configuration | embeds identical whole-file/part text once while preserving all database row indices
## Verifies
semantic-cosine-chunk-search, stale-vector-rejection
## Exercises
embedding-row, embedding-fingerprint, sqlite-metadata-row