---
id: acceptance-mcp-input-repair-refused
name: repair refused acceptance
title: "Acceptance: Mcp Input Repair Refused"
description: The scenario mcp-input-repair-refused is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - mcp-refuses-conflicting-repair
    - mcp-enforces-repair-budget
---
## Scenario
mcp-input-repair-refused - Mcp Input Repair Refused
## Criteria covered
mcp-refuses-conflicting-repair, mcp-enforces-repair-budget
## Evidence
test/json-repair-routing.test.ts, test/mcp.test.ts