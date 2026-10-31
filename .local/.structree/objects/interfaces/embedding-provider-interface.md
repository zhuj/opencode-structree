---
id: embedding-provider-interface
name: Embedding Provider Interface
title: Embedding Provider Interface
description: Defines the batched embedding contract every provider must satisfy.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T04:45:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - embedding-fingerprint-invalidation
    - api-key-not-in-fingerprint
    - api-key-read-at-request-time
  commitsTo:
    - adr-onnx-execution-device
    - adr-openai-compatible-embeddings
    - adr-embedding-windows
    - adr-prepare-the-model-snapshot-at-startup
---
## Surface
src/lib/types.ts - the EmbeddingProvider interface.
## Behavior
Defines the batched embedding contract every provider must satisfy.
## Guarantees
- The provider reports a fixed dimension count and a fingerprint.
- The fingerprint must change whenever the vector space or preprocessing changes.
- Embed requests accept an abort signal and a query or document purpose.
- The interface carries an optional preparation step that ensures the provider can serve embeddings before a query needs it; a provider without one is still valid.