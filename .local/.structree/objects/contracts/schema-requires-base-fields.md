---
id: schema-requires-base-fields
name: Schema Requires The Base Contract
title: Schema Requires The Base Contract
description: Every registered type must supply the full shared object contract.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-schema-registration-base-contract
---
## Rule
Registration MUST fail with INVALID_DEFINITION when a schema omits any of id, name, title, description, createdAt, updatedAt, retiredAt, tags or metadata, including when the schema is a union.
## Evidence
src/lib/registry.ts:9-19; src/lib/registry.ts:69-77; src/lib/registry.ts:211-218
## Why it matters
The cache binds these fields as columns, so a missing field would fail every later index write.