---
id: mcp-advertises-generated-tools
name: mcp advertises generated tools
title: Advertise the generated tools
description: The server exposes create, get, update, delete and list for every registered type plus the search, resync, status and definitions tools.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: mcp-crud-tool-round-trip
  dependsOn: []
---
## Statement
Advertise the generated tools: The server exposes create, get, update, delete and list for every registered type plus the search, resync, status and definitions tools.
## How it is observed
The tool list contains five tools for each registered type plus objects_search, objects_resync, objects_status and objects_definitions.