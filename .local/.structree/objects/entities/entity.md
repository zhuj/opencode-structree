---
id: entity
name: Entity
title: Entity
description: A domain entity with hierarchy, dependencies, contract usage and interface usage.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - adr
    - contract
    - interface
  usedBy:
    - object-identity-key
    - source-files-authoritative
  usedIn:
    - object-facade
    - mcp-object-crud-tools
    - search-api
    - mcp-objects-search
    - mcp-objects-definitions
  commitsTo:
    - adr-schema-registration-base-contract
---
## Fields
- Base: id, name, title, description, createdAt, updatedAt, retiredAt, tags, metadata
- Relations: relations.partOf, relations.dependsOn, relations.usedBy, relations.usedIn, relations.commitsTo
## Lifecycle
Created and updated as a file under entities/ and committed to by unit tests.
## Usage
Committed to by unit tests and served by the facade, the CRUD tools and the search tools.