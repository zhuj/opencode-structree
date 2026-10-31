---
id: adr-onnx-execution-device
name: ONNX execution device
title: ONNX Execution Device
description: The ONNX embedding provider runs on a configured cpu or cuda device that is part of the provider fingerprint, and an unusable CUDA backend is reported as DEVICE_UNAVAILABLE.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - embedding-provider-failures
      - semantic-cosine-chunk-search
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's progress record `.local/.progress/2026-10-20-1504-embeddings-device-and-openai-compatible.md`. The framework's ONNX provider was pinned to CPU, and the user asked on 2026-10-20 to "add support local onnx (both cpu only and cuda)". The ONNX Runtime Node build advertises CUDA on Linux x64 regardless of whether the CUDA libraries are present, so an unusable backend otherwise arrives as an opaque runtime error. No model snapshot was prepared in this environment and downloads were not allowed, so real inference and a real CUDA session could not be exercised.

## Decision
The ONNX provider accepts a `device` of `cpu` or `cuda`, defaulting to `cpu` and rejecting any other value with the existing configuration error, and the device is threaded into the runtime options and the provider fingerprint, so the same model on two devices has two fingerprints. An unusable CUDA backend is reported as `DEVICE_UNAVAILABLE` naming `cpu` as the alternative, while a missing model keeps its own error. The change was implemented and verified on 2026-10-20.

## Consequences
- Cached vectors are not reused across devices, because the same model on CPU and CUDA can produce different vectors, so switching devices invalidates derived data.
- A CUDA runtime that is advertised but unusable now produces a stable, actionable error code instead of an opaque upstream runtime failure.
- Only unit tests and the failure mapping cover the CUDA path, since the CUDA backend is not installed and no model snapshot was prepared, so no real inference and no real CUDA session were exercised.
- The device is part of the fingerprint, so a device change invalidates previously cached embeddings and requires a rebuild of the derived index.

## Evidence
- `.local/.progress/2026-10-20-1504-embeddings-device-and-openai-compatible.md` (acceptance criteria AC1, AC2 and AC3, and the decisions log)
- `src/lib/embeddings/onnx.ts`, `src/lib/config.ts` and `src/lib/types.ts`
- `test/embeddings.test.ts` and commit `0d1a5d9`