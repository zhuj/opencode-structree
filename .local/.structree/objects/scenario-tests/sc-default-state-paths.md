---
id: sc-default-state-paths
name: the default object, database and model cache paths live under the project root
title: Default State Paths Under Project Root
description: Shows that the default root, index and model cache resolve under .local/.structree.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-default-state-paths
  commitsTo:
    - config-loader-api
---
## Test
the default object; database and model cache paths live under the project root
## File
test/config.test.ts
## What it proves
Shows that the default root, index and model cache resolve under .local/.structree.
## Criteria
default-state-paths-under-structree