---
id: embedding-provider-failures
name: provider failures
title: Embedding Provider Failures
description: Reports missing credentials, permanent HTTP errors, malformed responses and an unusable CUDA backend with stable error codes.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T04:45:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - openai-embedding-request
  commitment:
    features:
      - embedding-providers
---
## Context
Reports missing credentials, permanent HTTP errors, malformed responses and an unusable CUDA backend with stable error codes.

## Expected behaviour
A configured provider reports stable error codes for missing credentials, bad payloads and unusable devices.

## Failure modes
A named but unset key raises API_KEY_MISSING and an unusable CUDA backend raises DEVICE_UNAVAILABLE.

## Covered by
embedding-missing-api-key, embedding-invalid-response-rejected, embedding-device-unavailable

The pinned model snapshot is prepared at startup when the configuration permits the fetch, and a failed preparation is reported without taking the full-text path down.