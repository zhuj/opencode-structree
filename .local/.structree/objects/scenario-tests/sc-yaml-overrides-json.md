---
id: sc-yaml-overrides-json
name: a local YAML configuration overrides an explicit JSON configuration
title: Yaml Overrides Json
description: Shows that the local YAML layer replaces the JSON configuration values.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-local-yaml-override-layer
  commitsTo:
    - config-loader-api
---
## Test
a local YAML configuration overrides an explicit JSON configuration
## File
test/config.test.ts
## What it proves
Shows that the local YAML layer replaces the JSON configuration values.
## Criteria
yaml-override-applies-last