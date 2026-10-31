---
id: yaml-override-parse-failure-reported
name: yaml override parse failure reported
title: Report an unparsable yaml layer
description: A malformed or non-object local YAML file raises a CONFIG error naming the offending file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: local-yaml-override-layer
  dependsOn: []
---
## Statement
Report an unparsable yaml layer: A malformed or non-object local YAML file raises a CONFIG error naming the offending file.
## How it is observed
loadConfig rejects with a CONFIG error whose message contains the absolute path of the YAML file.