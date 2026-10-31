---
id: sc-search-fulltext-without-provider
name: Sc Search Fulltext Without Provider
title: Sc Search Fulltext Without Provider
description: The explicit full-text path and the empty type subset never reach the provider, and the provider error contracts are unchanged.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-search-provider-fallback
  commitsTo:
    - mcp-objects-search
    - object-facade
---
## Test
an explicit fulltext query and an empty type subset never invoke a failing provider; a disabled provider keeps the two error contracts
## File
test/framework.test.ts, test/mcp.test.ts
## What it proves
Shows that a caller can query without embeddings, and that a failing or missing provider is reported rather than worked around.
## Criteria
search-explicit-fulltext-avoids-the-provider