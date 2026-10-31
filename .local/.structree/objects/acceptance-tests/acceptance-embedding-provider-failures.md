---
id: acceptance-embedding-provider-failures
name: provider failures acceptance
title: "Acceptance: Embedding Provider Failures"
description: The scenario embedding-provider-failures is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - embedding-missing-api-key
    - embedding-invalid-response-rejected
    - embedding-device-unavailable
---
## Scenario
embedding-provider-failures - Embedding Provider Failures
## Criteria covered
embedding-missing-api-key, embedding-invalid-response-rejected, embedding-device-unavailable
## Evidence
test/embeddings.test.ts