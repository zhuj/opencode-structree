---
id: sc-config-rejects-cache-in-root
name: configuration merges provider defaults, resolves paths and rejects ambiguous or invalid values
title: Config Rejects Cache Inside Root
description: Shows that a sqlite path inside the object root is refused with an outside-root error.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-state-path-isolation-violation
  commitsTo:
    - config-loader-api
---
## Test
configuration merges provider defaults; resolves paths and rejects ambiguous or invalid values
## File
test/config.test.ts
## What it proves
Shows that a sqlite path inside the object root is refused with an outside-root error.
## Criteria
sqlite-cache-outside-root-enforced