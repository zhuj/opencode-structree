---
id: sc-repair-budget
name: enforces configured input budgets before calling handlers, including strict mode
title: Repair Budget Enforced
description: Shows that inputs above the configured budget never reach a handler.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-mcp-input-repair-refused
  commitsTo:
    - mcp-input-repair-boundary
---
## Test
enforces configured input budgets before calling handlers; including strict mode
## File
test/mcp.test.ts
## What it proves
Shows that inputs above the configured budget never reach a handler.
## Criteria
mcp-enforces-repair-budget