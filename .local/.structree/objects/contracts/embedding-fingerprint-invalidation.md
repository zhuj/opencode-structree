---
id: embedding-fingerprint-invalidation
name: Embedding Fingerprint Invalidation
title: Embedding Fingerprint Invalidation
description: Changing the model, preprocessing or chunk settings invalidates the cached vectors.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-embedding-windows
    - adr-onnx-execution-device
---
## Rule
The fingerprint MUST cover the provider identity, the chunk size and the chunk overlap, and a changed fingerprint or changed chunk settings MUST mark every object's embeddings as needing recomputation even when the source checksum is unchanged.
## Evidence
src/lib/chunking.ts:27-40; src/lib/sqlite/index.ts:179-189; docs/configuration.md:89; docs/embeddings.md:51
## Why it matters
Vectors from a different vector space are not comparable with the new ones.