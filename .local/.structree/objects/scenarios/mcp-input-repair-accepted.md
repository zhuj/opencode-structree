---
id: mcp-input-repair-accepted
name: repair accepted
title: Mcp Input Repair Accepted
description: Repairs stringified containers, wrapper omissions and key casing so the strict decoder accepts the arguments.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - mcp-input-repair
      - mcp-tool-surface
---
## Context
Repairs stringified containers, wrapper omissions and key casing so the strict decoder accepts the arguments.

## Expected behaviour
Stringified containers, missing wrappers and wrong key casing are repaired and then strictly validated.

## Failure modes
A repair that cannot be proven safe leaves the input invalid.

## Covered by
mcp-repairs-malformed-arguments, mcp-reports-repair-notices