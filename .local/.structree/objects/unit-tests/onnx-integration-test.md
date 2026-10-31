---
id: onnx-integration-test
name: onnx-integration.test.ts
title: Onnx Integration Test
description: Runs a real ONNX model through the filesystem, sqlite-vec and an official MCP client when a model configuration is supplied.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo: []
  commitsTo:
    - embedding-row
    - embedding-fingerprint
    - search-hit
---
## File
test/onnx-integration.test.ts
## What it covers
actual ONNX -> filesystem -> sqlite-vec -> official MCP retrieval
## Verifies
semantic-cosine-chunk-search, mcp-crud-tool-round-trip
## Exercises
embedding-row, embedding-fingerprint, search-hit
## Note
Runs only when a model configuration is supplied; it is skipped otherwise. It exercises the local ONNX provider and no external OpenAI-compatible endpoint.