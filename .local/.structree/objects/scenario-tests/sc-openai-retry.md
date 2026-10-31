---
id: sc-openai-retry
name: retries a transient response, then restores reordered vectors to input order
title: Openai Retries Transient Response
description: Shows that a transient response is retried and vector order is restored afterwards.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-openai-embedding-request
  commitsTo:
    - embedding-provider-interface
---
## Test
retries a transient response; then restores reordered vectors to input order
## File
test/embeddings.test.ts
## What it proves
Shows that a transient response is retried and vector order is restored afterwards.
## Criteria
openai-retries-transient-status