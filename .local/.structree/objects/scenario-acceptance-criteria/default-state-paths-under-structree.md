---
id: default-state-paths-under-structree
name: default state paths under structree
title: Keep Project State Local And Model Snapshots Shared
description: Default object, SQLite and override paths are project-local; default ONNX model snapshots use the shared user cache.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-31T13:22:34.326Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: default-state-paths
  dependsOn: []
---
## Observed Statement

For [[scenarios/default-state-paths|Default State Paths]], the default object root is .local/.structree/objects, the SQLite path is .local/.structree/.cache/index.sqlite, and the optional override is .local/.structree/config.yaml relative to the project. The default ONNX model cache is <absolute XDG_CACHE_HOME>/onnx/models, falling back to ~/.cache/onnx/models when XDG_CACHE_HOME is absent or not absolute.

The earlier statement that all state, including model snapshots, is project-local is superseded by the inspected implementation and [[adrs/adr-keep-model-snapshots-in-the-user-cache|Shared User Model Cache]]. The stable criterion ID is retained.

## Source Evidence

src/lib/config.ts:10,105,114,144,254. This is source inspection, not a fresh test execution.
