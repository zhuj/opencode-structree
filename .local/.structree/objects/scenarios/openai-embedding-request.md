---
id: openai-embedding-request
name: openai request
title: Openai Embedding Request
description: Sends prefixed UTF-8 window batches to the embeddings endpoint and restores the response order by input index.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - embedding-providers
---
## Context
Sends prefixed UTF-8 window batches to the embeddings endpoint and restores the response order by input index.

## Expected behaviour
The provider posts prefixed window batches and returns normalized vectors in input order.

## Failure modes
A permanent HTTP status or a malformed payload fails without retrying.

## Covered by
openai-sends-prefixed-batch, openai-retries-transient-status