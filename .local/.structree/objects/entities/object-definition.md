---
id: object-definition
name: Object Definition
title: Object Definition
description: A registry entry binding a type name, a directory and an Effect schema.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - schema-requires-base-fields
    - unknown-fields-rejected
  usedIn:
    - object-registry
    - core-object-registry
    - object-facade
    - mcp-objects-definitions
    - mcp-object-crud-tools
    - mcp-input-repair-boundary
    - json-repair-parser
  commitsTo:
    - adr-schema-registration-base-contract
---
## Fields
- name, directory, description
- schema
## Lifecycle
Registered and frozen at boot, never mutated afterwards, and removable only by restarting the framework with a different registry.
## Usage
Consumed by the registry, the facade and the tool generator, and exposed as JSON Schema by the definitions tool.