---
id: sc-mcp-repair-notices
name: keeps repair notices with their own responses during overlapping calls
title: Mcp Repair Notices Kept
description: Shows that each response carries the repair notices of its own arguments.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-mcp-input-repair-accepted
  commitsTo:
    - mcp-input-repair-boundary
---
## Test
keeps repair notices with their own responses during overlapping calls
## File
test/mcp.test.ts
## What it proves
Shows that each response carries the repair notices of its own arguments.
## Criteria
mcp-reports-repair-notices