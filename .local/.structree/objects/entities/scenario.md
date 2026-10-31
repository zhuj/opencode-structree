---
id: scenario
name: Scenario
title: Scenario
description: A project scenario with hierarchy, dependencies and feature commitments.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - project
    - feature
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
- Relations: relations.project, relations.partOf, relations.dependsOn, relations.commitment.features
## Lifecycle
Created and updated as a file under scenarios/, with dependencies and commitments replaced in full on each update.
## Usage
Committed to by decision records and acceptance criteria, and served by the facade, the CRUD tools and the search tools.