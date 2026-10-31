---
id: mcp-refuses-conflicting-repair
name: mcp refuses conflicting repair
title: Refuse a conflicting repair
description: Arguments whose fields cannot be routed to one unambiguous destination fail validation before the handler runs.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: mcp-input-repair-refused
  dependsOn: []
---
## Statement
Refuse a conflicting repair: Arguments whose fields cannot be routed to one unambiguous destination fail validation before the handler runs.
## How it is observed
Validation fails with an issue and the handler is never invoked.