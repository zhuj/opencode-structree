---
id: acceptance-openai-embedding-request
name: openai request acceptance
title: "Acceptance: Openai Embedding Request"
description: The scenario openai-embedding-request is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - openai-sends-prefixed-batch
    - openai-retries-transient-status
---
## Scenario
openai-embedding-request - Openai Embedding Request
## Criteria covered
openai-sends-prefixed-batch, openai-retries-transient-status
## Evidence
test/embeddings.test.ts