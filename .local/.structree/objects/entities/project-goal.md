---
id: project-goal
name: Project Goal
title: Project Goal
description: A goal owned by a project with an optional parent goal.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - project
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
- Relations: relations.project, relations.partOf
## Lifecycle
Created and updated as a file under project-goals/, with the owning project required on every write.
## Usage
Referenced by feature commitments and served by the facade, the CRUD tools and the search tools.