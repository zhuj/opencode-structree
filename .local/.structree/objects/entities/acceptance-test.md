---
id: acceptance-test
name: Acceptance Test
title: Acceptance Test
description: An acceptance test with hierarchy, dependencies and commitments to scenario acceptance criteria.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - scenario-acceptance-criteria
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
Created and updated as a file under acceptance-tests/ and committed to scenario acceptance criteria identifiers.
## Usage
Related to scenario tests and served by the facade, the CRUD tools and the search tools.