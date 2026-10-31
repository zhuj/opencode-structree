---
id: sc-json-config-merges-defaults
name: configuration merges provider defaults, resolves paths and rejects ambiguous or invalid values
title: Config Merges Provider Defaults
description: Shows that provider defaults merge with shared defaults and that invalid bounds and paths are rejected.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-load-json-configuration
  commitsTo:
    - config-loader-api
---
## Test
configuration merges provider defaults; resolves paths and rejects ambiguous or invalid values
## File
test/config.test.ts
## What it proves
Shows that provider defaults merge with shared defaults and that invalid bounds and paths are rejected.
## Criteria
json-config-provider-defaults-merged, json-config-paths-resolved, json-config-invalid-values-rejected