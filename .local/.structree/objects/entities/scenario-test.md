---
id: scenario-test
name: Scenario Test
title: Scenario Test
description: A scenario test with hierarchy, dependencies, related acceptance tests and interface commitments.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
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
- Relations: relations.partOf, relations.dependsOn, relations.relatesTo, relations.commitsTo
## Lifecycle
Created and updated as a file under scenario-tests/ and committed to interface identifiers.
## Usage
Related to unit and acceptance tests and served by the facade, the CRUD tools and the search tools.