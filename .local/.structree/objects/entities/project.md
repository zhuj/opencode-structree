---
id: project
name: Project
title: Project
description: A top-level project object that may declare an optional parent project.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - object-identity-key
    - checksum-guarded-writes
    - source-files-authoritative
  usedIn:
    - object-facade
    - mcp-object-crud-tools
    - search-api
    - mcp-objects-search
    - mcp-objects-definitions
    - mcp-objects-status
  commitsTo:
    - adr-schema-registration-base-contract
---
## Fields
- Base: id, name, title, description, createdAt, updatedAt, retiredAt, tags, metadata
- Relations: relations.partOf
## Lifecycle
Created as a Markdown file under projects/, replaced in full by an update, retired by setting retiredAt, and removed by an actual file deletion.
## Usage
Read and written through the object facade and the generated CRUD tools, and served by the search and definitions tools.