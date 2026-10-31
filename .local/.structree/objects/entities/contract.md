---
id: contract
name: Contract
title: Contract
description: A contract with hierarchy and dependencies that commits to architecture decision records.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - adr
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
- Relations: relations.partOf, relations.dependsOn, relations.commitsTo
## Lifecycle
Created and updated as a file under contracts/ and referenced by interfaces and entities.
## Usage
Committed to by interfaces and entities, and served by the facade, the CRUD tools and the search tools.