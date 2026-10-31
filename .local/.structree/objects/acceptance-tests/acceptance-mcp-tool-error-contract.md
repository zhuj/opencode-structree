---
id: acceptance-mcp-tool-error-contract
name: mcp errors acceptance
title: "Acceptance: Mcp Tool Error Contract"
description: The scenario mcp-tool-error-contract is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - mcp-rejects-stale-checksum
    - mcp-rejects-invalid-input
---
## Scenario
mcp-tool-error-contract - Mcp Tool Error Contract
## Criteria covered
mcp-rejects-stale-checksum, mcp-rejects-invalid-input
## Evidence
test/mcp.test.ts