---
id: mcp-enforces-repair-budget
name: mcp enforces repair budget
title: Enforce the repair budget
description: Input exceeding the configured byte, node, depth or repair budget is refused with a resource limit error.
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
Enforce the repair budget: Input exceeding the configured byte, node, depth or repair budget is refused with a resource limit error.
## How it is observed
Validation fails with a resource limit issue before the handler is invoked.