---
id: sc-mcp-crud-round-trip
name: round-trips CRUD through real protocol serialization with Date conversion and revision errors
title: Mcp Crud Round Trip
description: Shows that CRUD calls survive protocol serialization with ISO dates and revision errors.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-mcp-crud-tool-round-trip
  commitsTo:
    - mcp-object-crud-tools
    - object-facade
---
## Test
round-trips CRUD through real protocol serialization with Date conversion and revision errors
## File
test/mcp.test.ts
## What it proves
Shows that CRUD calls survive protocol serialization with ISO dates and revision errors.
## Criteria
mcp-crud-round-trips-through-protocol