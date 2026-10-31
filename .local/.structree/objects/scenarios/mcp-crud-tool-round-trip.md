---
id: mcp-crud-tool-round-trip
name: mcp crud
title: Mcp Crud Tool Round Trip
description: Exposes the generated tools and round-trips create, get, update, delete and list through real protocol serialization.
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
      - mcp-tool-surface
---
## Context
Exposes the generated tools and round-trips create, get, update, delete and list through real protocol serialization.

## Expected behaviour
The advertised tools cover every registered type and round-trip objects through the protocol.

## Failure modes
An unknown type or an invalid argument shape fails before the facade runs.

## Covered by
mcp-advertises-generated-tools, mcp-crud-round-trips-through-protocol