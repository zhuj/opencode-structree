---
id: sc-yaml-parse-error
name: a local YAML configuration that cannot be parsed reports the offending file
title: Yaml Parse Error Reported
description: Shows that an unparsable local override raises a CONFIG error naming the file.
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
a local YAML configuration that cannot be parsed reports the offending file
## File
test/config.test.ts
## What it proves
Shows that an unparsable local override raises a CONFIG error naming the file.
## Criteria
yaml-override-parse-failure-reported