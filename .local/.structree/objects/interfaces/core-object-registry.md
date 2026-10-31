---
id: core-object-registry
name: Core Object Registry
title: Core Object Registry
description: Supplies the twelve frozen core object definitions and their registry.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-registry
  usedBy:
    - schema-requires-base-fields
    - unknown-fields-rejected
  commitsTo:
    - adr-schema-registration-base-contract
    - adr-project-local-mcp-registration
---
## Surface
src/registry.ts - coreDefinitions and createCoreRegistry.
## Behavior
Supplies the twelve frozen core object definitions and their registry.
## Guarantees
- Each definition names one directory and one domain schema.
- The definitions are frozen and shared by every instance of the core application.
- The root application factory falls back to this set when no registry is supplied.