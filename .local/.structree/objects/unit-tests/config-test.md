---
id: config-test
name: config.test.ts
title: Config Test
description: Covers default merging, path resolution, section layering and the local YAML override rules.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T04:50:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-json-config-merges-defaults
    - sc-yaml-overrides-json
    - sc-yaml-parse-error
    - sc-default-state-paths
    - sc-config-rejects-cache-in-root
  commitsTo:
    - configuration-layer
    - embedding-fingerprint
    - object-definition
---
## File
test/config.test.ts
## What it covers
configuration merges provider defaults; resolves paths and rejects ambiguous or invalid values | vault confinement modes are configurable and partial synchronization settings retain auto | MCP input repair defaults are bounded and nested overrides preserve other settings | the default object; database and model cache paths live under the project root | a local YAML configuration overrides an explicit JSON configuration | a local YAML configuration overrides the built-in defaults | a local YAML configuration merges section by section | a missing local YAML configuration leaves the JSON configuration untouched | the default local configuration location is read when it exists | a local YAML configuration that cannot be parsed reports the offending file | a local YAML configuration must be an object | a local YAML configuration rejects unknown top-level keys | local YAML paths resolve against the project root instead of the JSON directory | a local YAML embedding model does not leak into a disabled provider | an explicit null local configuration file disables the override layer | the ONNX provider selects a CPU or CUDA execution device and defaults to the CPU | the OpenAI provider accepts an optional literal API key and a keyless endpoint | a local YAML configuration can carry the literal OpenAI API key | the default configuration permits fetching a missing model snapshot and the offline switch keeps the offline-only behavior
## Verifies
load-json-configuration, local-yaml-override-layer, default-state-paths, state-path-isolation-violation, model-snapshot-prepared-at-startup
## Exercises
configuration-layer, embedding-fingerprint, object-definition