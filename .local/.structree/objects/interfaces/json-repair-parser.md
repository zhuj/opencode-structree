---
id: json-repair-parser
name: JSON Repair Parser
title: JSON Repair Parser
description: Provides a standalone Effect-validated relaxed JSON parser and its lower-level repair primitives.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - repair-preserves-strictness
  commitsTo:
    - adr-repair-mcp-inputs-before-validation
---
## Surface
src/lib/json-repair/index.ts - parseJson and the lower-level repair APIs.
## Behavior
Provides a standalone Effect-validated relaxed JSON parser and its lower-level repair primitives.
## Guarantees
- The repaired value must pass the supplied strict Effect schema.
- Depth, node count, byte size and repair count stay inside the configured bounds.
- An ambiguous or unsafe candidate fails instead of guessing.