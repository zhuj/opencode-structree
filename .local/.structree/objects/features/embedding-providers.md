---
id: embedding-providers
name: embedding providers
title: Embedding Providers
description: Supplies disabled, ONNX and OpenAI embedding providers with stable fingerprints, windowed inputs and stable error codes.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
## What it does
Supplies disabled, ONNX and OpenAI embedding providers with stable fingerprints, windowed inputs and stable error codes.

## Where it lives
src/lib/embeddings/index.ts, src/lib/embeddings/onnx.ts, src/lib/embeddings/openai.ts, src/lib/embeddings/common.ts, src/lib/embeddings/model-cache.ts

## Scenarios
stale-vector-rejection, openai-embedding-request, embedding-provider-failures

## Verification
test/embeddings.test.ts; test/onnx-integration.test.ts