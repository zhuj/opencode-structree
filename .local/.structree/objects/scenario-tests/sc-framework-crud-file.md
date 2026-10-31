---
id: sc-framework-crud-file
name: CRUD persists exact schemas and separate body, unrestricted IDs cannot become paths
title: Framework Crud Persists Files
description: Shows that CRUD writes the exact schema and a separate body into a confined file path.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-markdown-frontmatter-round-trip
  commitsTo:
    - object-facade
    - vault-api
---
## Test
CRUD persists exact schemas and separate body; unrestricted IDs cannot become paths
## File
test/framework.test.ts
## What it proves
Shows that CRUD writes the exact schema and a separate body into a confined file path.
## Criteria
markdown-serializes-frontmatter-and-body, markdown-checksum-stable