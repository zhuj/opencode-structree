---
id: search-explicit-fulltext-avoids-the-provider
name: Search Explicit Fulltext Avoids The Provider
title: Search Explicit Fulltext Avoids The Provider
description: An explicit full-text query and an empty type subset never invoke the embedding provider, and a failing or missing provider keeps its error contract.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: embedding-provider-failures
  dependsOn: []
---
## Statement
Search explicit fulltext avoids the provider: A request with mode fulltext, or with an empty type subset, never calls the embedding provider, and a semantic or hybrid request without a usable provider fails with EMBEDDINGS_DISABLED or EMBEDDINGS_UNAVAILABLE rather than falling back to full text.
## How it is observed
A deterministic failing provider is never invoked by the explicit full-text path or by an empty type subset, both provider error codes are retained, and the advertised mode description names the full-text recovery.