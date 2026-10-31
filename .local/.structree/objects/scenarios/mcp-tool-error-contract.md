---
id: mcp-tool-error-contract
name: mcp errors
title: Mcp Tool Error Contract
description: Returns structured error codes for stale checksums, unknown types and invalid arguments before any mutation runs.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - mcp-crud-tool-round-trip
  commitment:
    features:
      - mcp-tool-surface
---
## Context
Returns structured error codes for stale checksums, unknown types and invalid arguments before any mutation runs.

## Expected behaviour
A successful call returns the stored object with its path and checksum.

## Failure modes
A stale checksum returns CHECKSUM_CONFLICT and invalid arguments are refused before any mutation.

## Covered by
mcp-rejects-stale-checksum, mcp-rejects-invalid-input