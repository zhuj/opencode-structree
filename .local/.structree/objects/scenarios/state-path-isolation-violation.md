---
id: state-path-isolation-violation
name: path isolation
title: State Path Isolation Violation
description: Rejects a configuration that places the SQLite cache or the model cache inside the authoritative object directory.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - default-state-paths
  commitment:
    features:
      - local-state-layout
      - config-loading-and-layering
---
## Context
Rejects a configuration that places the SQLite cache or the model cache inside the authoritative object directory.

## Expected behaviour
A cache and a model cache that both sit outside the object root are accepted.

## Failure modes
A sqlite path or model cache inside the root raises a CONFIG error.

## Covered by
sqlite-cache-outside-root-enforced, model-cache-outside-root-enforced