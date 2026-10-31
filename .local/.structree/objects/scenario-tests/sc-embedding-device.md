---
id: sc-embedding-device
name: a CUDA initialization failure is reported as DEVICE_UNAVAILABLE
title: Cuda Failure Reported
description: Shows that an unusable execution provider maps to the DEVICE_UNAVAILABLE code.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-embedding-provider-failures
  commitsTo:
    - embedding-provider-interface
---
## Test
a CUDA initialization failure is reported as DEVICE_UNAVAILABLE
## File
test/embeddings.test.ts
## What it proves
Shows that an unusable execution provider maps to the DEVICE_UNAVAILABLE code.
## Criteria
embedding-device-unavailable