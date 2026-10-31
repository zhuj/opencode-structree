---
id: adr
name: Architecture Decision Record
title: Architecture Decision Record
description: A decision record with hierarchy, dependencies and scenario commitments.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - scenario
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
- Relations: relations.commitment.scenarios, relations.partOf, relations.dependsOn
## Lifecycle
Created and updated as a file under adrs/ and referenced by contracts, interfaces and entities.
## Usage
Committed to by contracts, interfaces and entities, and served by the facade, the CRUD tools and the search tools.