---
id: config-loader-api
name: Config Loader API
title: Config Loader API
description: Loads, merges and validates the layered framework configuration into a fully resolved FrameworkConfig.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - config-never-migrates-objects
    - embedding-base-url-sanitized
    - cache-outside-source-root
    - config-rejects-invalid-settings
  commitsTo:
    - adr-configuration-layering
    - adr-project-local-mcp-registration
---
## Surface
src/lib/config.ts - loadConfig, defineConfig and defaultConfig.
## Behavior
Loads, merges and validates the layered framework configuration into a fully resolved FrameworkConfig.
## Guarantees
- Unknown keys, invalid bounds and unsupported providers are rejected before any tool is served.
- Relative paths resolve against the layer that declared them.
- Loading never writes to disk and never mutates a stored object.