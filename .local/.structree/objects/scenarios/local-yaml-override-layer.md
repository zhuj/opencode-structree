---
id: local-yaml-override-layer
name: yaml override
title: Local Yaml Override Layer
description: Applies the optional .local/.structree/config.yaml as the last configuration layer and reports an unparsable or non-object file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - load-json-configuration
  commitment:
    features:
      - config-loading-and-layering
      - local-state-layout
---
## Context
Applies the optional .local/.structree/config.yaml as the last configuration layer and reports an unparsable or non-object file.

## Expected behaviour
Values from the local YAML file replace the same keys of the layer below while partial sections merge.

## Failure modes
A missing file is ignored but an unparsable or non-object file raises a CONFIG error naming the file.

## Covered by
yaml-override-applies-last, yaml-override-parse-failure-reported