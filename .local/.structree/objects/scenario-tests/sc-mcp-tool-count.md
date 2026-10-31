---
id: sc-mcp-tool-count
name: advertises all 64 tools with schema-derived required fields and optional wrapper keys
title: All Generated Tools Advertised
description: Shows that the server advertises one CRUD set per type plus the four global tools.
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
    - mcp-server-factory
    - mcp-object-crud-tools
---
## Test
advertises all 64 tools with schema-derived required fields and optional wrapper keys
## File
test/mcp.test.ts
## What it proves
Shows that the server advertises one CRUD set per type plus the four global tools.
## Criteria
mcp-advertises-generated-tools