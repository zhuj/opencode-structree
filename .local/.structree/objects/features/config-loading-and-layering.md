---
id: config-loading-and-layering
name: config loading
title: Config Loading And Layering
description: Loads, validates and layers built-in defaults, a JSON config file and an optional local YAML override into one resolved framework configuration.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
## What it does
Loads, validates and layers built-in defaults, a JSON config file and an optional local YAML override into one resolved framework configuration.

## Where it lives
src/lib/config.ts, src/lib/types.ts, src/cli.ts

## Scenarios
load-json-configuration, local-yaml-override-layer, state-path-isolation-violation

## Verification
test/config.test.ts; test/cli.test.ts