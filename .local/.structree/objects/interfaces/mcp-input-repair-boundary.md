---
id: mcp-input-repair-boundary
name: MCP Input Repair Boundary
title: MCP Input Repair Boundary
description: Adapts Effect schemas into MCP Standard Schema inputs with bounded, configurable repair.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - json-repair-parser
  usedBy:
    - repair-preserves-strictness
  commitsTo:
    - adr-repair-mcp-inputs-before-validation
---
## Surface
src/lib/mcp-input.ts - createMcpInputBoundary and effectMcpSchema.
## Behavior
Adapts Effect schemas into MCP Standard Schema inputs with bounded, configurable repair.
## Guarantees
- Strict Effect validation is attempted before any repair runs.
- A repaired candidate must still pass the original strict codec.
- Accepted repairs are reported under the input-repair metadata key.