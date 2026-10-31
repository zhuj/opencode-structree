---
id: mcp-input-repair
name: input repair
title: Mcp Input Repair
description: Repairs malformed MCP arguments against the advertised JSON schema before strict Effect validation while preserving strict outputs.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
## What it does
Repairs malformed MCP arguments against the advertised JSON schema before strict Effect validation while preserving strict outputs.

## Where it lives
src/lib/json-repair/index.ts, src/lib/json-repair/pipeline.ts, src/lib/json-repair/syntax.ts, src/lib/json-repair/name-mapper.ts, src/lib/json-repair/key-matcher.ts, src/lib/json-repair/schema-adapter.ts, src/lib/json-repair/property-safety.ts, src/lib/json-repair/types.ts

## Scenarios
mcp-input-repair-accepted, mcp-input-repair-refused

## Verification
test/mcp.test.ts; test/json-repair.test.ts; test/json-repair-safety.test.ts