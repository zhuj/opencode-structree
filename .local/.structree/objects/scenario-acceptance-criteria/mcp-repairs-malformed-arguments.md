---
id: mcp-repairs-malformed-arguments
name: mcp repairs malformed arguments
title: Repair malformed arguments
description: A request with a stringified nested container and a wrong key casing validates and reaches the handler.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: mcp-input-repair-accepted
  dependsOn: []
---
## Statement
Repair malformed arguments: A request with a stringified nested container and a wrong key casing validates and reaches the handler.
## How it is observed
The handler is invoked and the decoded arguments carry the expected nested values.