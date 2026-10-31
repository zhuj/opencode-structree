---
id: config-rejects-invalid-settings
name: Configuration Rejects Invalid Settings
title: Configuration Rejects Invalid Settings
description: Invalid configuration fails before any tool is served.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-configuration-layering
---
## Rule
Configuration MUST reject unknown keys, null sections, out-of-range bounds, unsupported provider or driver names, defaultTopN greater than maxTopN, a zero total search weight and a chunk overlap that leaves no new code point.
## Evidence
src/lib/config.ts:190-199; src/lib/config.ts:233-241; docs/configuration.md:3
## Why it matters
A rejected configuration fails loudly at startup instead of misbehaving at query time.