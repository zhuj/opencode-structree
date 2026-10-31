---
id: scenario-acceptance-criteria
name: Scenario Acceptance Criterion
title: Scenario Acceptance Criterion
description: An acceptance criterion owned by a scenario with its own dependency list.
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
- Relations: relations.scenario, relations.dependsOn
## Lifecycle
Created and updated as a file under scenario-acceptance-criteria/ and referenced by acceptance tests.
## Usage
Committed to by acceptance tests and served by the facade, the CRUD tools and the search tools.