---
id: embedding-fingerprint
name: Embedding Fingerprint
title: Embedding Fingerprint
description: The SHA-256 identity of the vector space and preprocessing that produced the cached vectors.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - configuration-layer
  usedBy:
    - embedding-fingerprint-invalidation
    - api-key-not-in-fingerprint
  usedIn:
    - embedding-provider-interface
    - chunking-api
    - sqlite-index-api
    - search-api
    - mcp-objects-status
  commitsTo:
    - adr-embedding-windows
    - adr-onnx-execution-device
---
## Fields
- version, provider
- size, overlap, overlapPoints
- digest
## Lifecycle
Derived from the provider identity plus the chunk settings at framework start, and compared against every stored row to decide whether vectors must be recomputed.
## Usage
Compared by the index before publishing vectors and reported by the status tool.