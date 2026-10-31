---
id: object-registry-and-schemas
name: object registry
title: Object Registry And Schemas
description: Registers typed object definitions and validates required base fields, JSON compatibility and finite numbers on every decode.
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
Registers typed object definitions and validates required base fields, JSON compatibility and finite numbers on every decode.

## Where it lives
src/lib/registry.ts, src/registry.ts, src/schemas/index.ts, src/schemas/base.ts, src/schemas/feature.ts, src/schemas/scenario.ts, src/schemas/interface.ts, src/schemas/entity.ts, src/schemas/contract.ts, src/schemas/adr.ts, src/schemas/project.ts, src/schemas/test-objects.ts

## Scenarios
markdown-frontmatter-round-trip, registry-registration-validation, invalid-definition-rejected

## Verification
test/registry.test.ts; test/schemas.test.ts