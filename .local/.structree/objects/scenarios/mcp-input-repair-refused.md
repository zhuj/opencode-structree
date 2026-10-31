---
id: mcp-input-repair-refused
name: repair refused
title: Mcp Input Repair Refused
description: Refuses ambiguous or conflicting repairs, unknown fields and inputs that exceed the configured repair budgets.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - mcp-input-repair-accepted
  commitment:
    features:
      - mcp-input-repair
---
## Context
Refuses ambiguous or conflicting repairs, unknown fields and inputs that exceed the configured repair budgets.

## Expected behaviour
Every accepted repair is reported in the response metadata.

## Failure modes
Ambiguous routing, unknown fields and budget overruns are refused before the handler runs.

## Covered by
mcp-refuses-conflicting-repair, mcp-enforces-repair-budget