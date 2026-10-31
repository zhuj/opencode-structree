---
id: sc-identifier-and-surface-restrictions
name: rejects empty identifiers without validating relation targets or relationship integrity
title: Rejects Empty Identifiers
description: Shows that an empty identifier is refused at the schema and at the tool boundary while a dangling target is still accepted.
createdAt: 2026-10-21T07:05:00.000Z
updatedAt: 2026-10-21T07:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-identifier-and-surface-restrictions
  commitsTo:
    - mcp-object-crud-tools
    - core-object-registry
---
## Test
rejects empty identifiers without validating relation targets or relationship integrity
## File
test/schemas.test.ts, test/mcp.test.ts
## What it proves
An empty identifier is refused at the schema and at the tool boundary, while a non-empty identifier naming a missing target is still accepted.
## Criteria
empty-identifiers-are-rejected