---
id: object-registry
name: Object Registry
title: Object Registry
description: Registers named Effect schemas and validates objects against the shared base contract.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - object-identity-key
    - schema-requires-base-fields
    - unknown-fields-rejected
  commitsTo:
    - adr-schema-registration-base-contract
---
## Surface
src/lib/registry.ts - the ObjectRegistry class.
## Behavior
Registers named Effect schemas and validates objects against the shared base contract.
## Guarantees
- Names are snake_case and directories are safe relative paths that do not overlap.
- A schema that omits a base field is rejected at registration time.
- Decoding and encoding are strict and reject unknown properties.