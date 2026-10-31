---
id: embeddings-test
name: embeddings.test.ts
title: Embeddings Test
description: Checks vector normalization, windowing, retries, credential handling and model cache identity for the embedding providers.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T04:45:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-openai-batch
    - sc-openai-retry
    - sc-embedding-missing-key
    - sc-embedding-invalid-response
    - sc-embedding-device
  commitsTo:
    - embedding-fingerprint
    - embedding-row
    - configuration-layer
---
## File
test/embeddings.test.ts
## What it covers
normalizes finite vectors and rejects zero; nonfinite; or wrong-dimensional output | UTF-8 windows preserve multilingual text and never split a Unicode code point | token-budget windows include the entire suffix and account for prefix plus special tokens | batches complete UTF-8 windows; adds the correct prefix; and uses API response indices | retries a transient response; then restores reordered vectors to input order | permanent HTTP errors and malformed indices are not retried | request timeout and caller cancellation abort the in-flight fetch | close cancels outstanding requests and rejects subsequent work | missing credentials cause no HTTP request; fingerprint tracks semantic preprocessing | a literal API key is sent as the bearer token and stays out of the fingerprint | the configured environment variable supplies the key when no literal key is set | an empty environment variable name sends no Authorization header | a named but unset environment variable still raises API_KEY_MISSING | the HTTP error message never repeats the key | a base URL carrying a query or fragment is rejected before any request | dimensions are sent for the text-embedding-3 family and omitted for other models | disabled and unused pinned remote providers do not load a model | local model content; not a directory name; controls cache identity | the runtime options carry the configured device; dtype; and cache directory | the execution device participates in the cache identity | a local model directory keeps its content identity under a non-default device | a CUDA initialization failure is reported as DEVICE_UNAVAILABLE | an oversized download is cancelled and leaves no temporary residue | a complete snapshot is prepared with no network request; a missing one is refused when downloads are not permitted; and the provider fetches the missing files when they are
## Verifies
openai-embedding-request, embedding-provider-failures, stale-vector-rejection, model-snapshot-prepared-at-startup
## Exercises
embedding-fingerprint, embedding-row, configuration-layer