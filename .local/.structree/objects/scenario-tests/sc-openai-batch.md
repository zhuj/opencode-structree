---
id: sc-openai-batch
name: batches complete UTF-8 windows, adds the correct prefix, and uses API response indices
title: Openai Batch Uses Response Indices
description: Shows that the provider posts prefixed batches and reassembles vectors by input index.
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
batches complete UTF-8 windows; adds the correct prefix; and uses API response indices
## File
test/embeddings.test.ts
## What it proves
Shows that the provider posts prefixed batches and reassembles vectors by input index.
## Criteria
openai-sends-prefixed-batch