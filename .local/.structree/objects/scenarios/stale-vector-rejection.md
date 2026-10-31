---
id: stale-vector-rejection
name: stale vectors
title: Stale Vector Rejection
description: Rejects a vector publication whose checksum, chunk offsets or model fingerprint no longer match the source document.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - semantic-cosine-chunk-search
  commitment:
    features:
      - semantic-vector-search
      - embedding-providers
---
## Context
Rejects a vector publication whose checksum, chunk offsets or model fingerprint no longer match the source document.

## Expected behaviour
A publication whose checksum and chunk offsets still match the source is committed.

## Failure modes
A stale checksum or a mismatched chunk is refused and the existing vectors stay in place.

## Covered by
stale-vector-publication-rejected, chunk-zero-must-match-whole-file