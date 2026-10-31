---
id: acceptance-search-provider-fallback
name: "Acceptance: Search Provider Fallback"
title: "Acceptance: Search Provider Fallback"
description: The explicit full-text path works without a provider and the provider errors are unchanged.
createdAt: 2026-10-21T00:20:00.000Z
updatedAt: 2026-10-21T00:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - search-explicit-fulltext-avoids-the-provider
---
## Scenario
embedding-provider-failures - Embedding Provider Failures
## Criteria covered
search-explicit-fulltext-avoids-the-provider
## Evidence
test/framework.test.ts, test/mcp.test.ts