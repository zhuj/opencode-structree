---
id: repair-preserves-strictness
name: Repair Preserves Strictness
title: Repair Preserves Strictness
description: Relaxed input handling never weakens the model or the outputs.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-repair-mcp-inputs-before-validation
---
## Rule
A repaired input MUST pass the original strict codec before a handler runs, the advertised JSON Schemas and the tool output schemas MUST remain strict, and repair MUST NOT invent missing required values.
## Evidence
docs/configuration.md:44; src/lib/mcp.ts:52-104; README.md:226
## Why it matters
Repair makes a model usable without letting a wrong value into a persisted object.