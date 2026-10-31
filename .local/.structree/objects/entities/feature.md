---
id: feature
name: Feature
title: Feature
description: A project feature that commits to one or more project goals.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - project
    - project-goal
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
- Relations: relations.project, relations.commitment.goals
## Lifecycle
Created and updated as a file under features/, with the goal commitments replaced in full on each update.
## Usage
Committed to by scenarios and served by the facade, the CRUD tools and the search tools.