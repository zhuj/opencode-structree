---
id: state-coordination-lock-location
name: state coordination lock location
title: Place the coordination lock under the root
description: The process coordination database is created as .object-mcp-lock.sqlite inside the configured object root.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: default-state-paths
  dependsOn: []
---
## Statement
Place the coordination lock under the root: The process coordination database is created as .object-mcp-lock.sqlite inside the configured object root.
## How it is observed
A file named .object-mcp-lock.sqlite exists inside the configured root after the framework starts.