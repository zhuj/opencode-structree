---
id: interface
name: Interface
title: Interface
description: A public interface with hierarchy, dependencies and the contracts that use it.
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
- Relations: relations.partOf, relations.dependsOn, relations.usedBy, relations.commitsTo
## Lifecycle
Created and updated as a file under interfaces/ and referenced by entities and scenario tests.
## Usage
Committed to by scenario tests and served by the facade, the CRUD tools and the search tools.