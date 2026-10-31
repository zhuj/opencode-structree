---
id: embedding-provider-factory
name: Embedding Provider Factory
title: Embedding Provider Factory
description: Builds the embedding provider selected by configuration.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T04:45:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - embedding-provider-interface
  usedBy:
    - stale-embeddings-invalidated
    - embedding-publication-guarded
    - embedding-fingerprint-invalidation
    - api-key-not-in-fingerprint
    - api-key-read-at-request-time
    - embedding-base-url-sanitized
  commitsTo:
    - adr-onnx-execution-device
    - adr-openai-compatible-embeddings
    - adr-embedding-windows
    - adr-prepare-the-model-snapshot-at-startup
---
## Surface
src/lib/embeddings/index.ts - createEmbeddingProvider.
## Behavior
Builds the embedding provider selected by configuration.
## Guarantees
- The disabled provider yields no provider and therefore no semantic search.
- Selecting a provider also selects that provider's own defaults.
- The provider is owned by the framework and is closed with it.
- The provider can ensure its own pinned snapshot exists before a query needs it, fetching the missing files when the configuration permits it and refusing when it does not, and it returns a complete snapshot without any network request.