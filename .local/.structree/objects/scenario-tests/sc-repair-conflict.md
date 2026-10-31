---
id: sc-repair-conflict
name: rejects duplicate destinations even when values agree and regardless of input order
title: Conflicting Destinations Rejected
description: Shows that ambiguous field routing is refused regardless of input order.
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
    - json-repair-parser
---
## Test
rejects duplicate destinations even when values agree and regardless of input order
## File
test/json-repair-routing.test.ts
## What it proves
Shows that ambiguous field routing is refused regardless of input order.
## Criteria
mcp-refuses-conflicting-repair