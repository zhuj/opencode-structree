---
id: load-json-configuration
name: json config
title: Load Json Configuration
description: Reads a JSON configuration file, merges provider defaults, resolves relative paths and rejects invalid values before any tool is served.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - config-loading-and-layering
---
## Context
Reads a JSON configuration file, merges provider defaults, resolves relative paths and rejects invalid values before any tool is served.

## Expected behaviour
The resolved configuration exposes merged defaults, absolute paths and a validated provider selection.

## Failure modes
Unknown keys, invalid bounds and out-of-range values raise a CONFIG error before the framework starts.

## Covered by
json-config-provider-defaults-merged, json-config-paths-resolved, json-config-invalid-values-rejected