---
id: sc-vault-file-naming
name: stores an object under its id and restores a name that disagrees
title: Stores An Object Under Its Id
description: Shows that a created object lives under its id and that the reconciliation keeps the name true.
createdAt: 2026-10-21T09:40:00.000Z
updatedAt: 2026-10-21T09:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-vault-file-naming
  commitsTo:
    - vault-api
    - mcp-object-crud-tools
---
## Test
stores an object under its id and restores a name that disagrees
## File
test/framework.test.ts, test/vault-sync.test.ts, test/schemas.test.ts
## What it proves
A create stores the object under the lowercase id, a mixed-case id finds the same object, an id outside the domain is refused, and a file whose name disagrees with its id is renamed back with the indexed path following.
## Criteria
an-id-is-always-lowercase, an-id-is-a-legal-file-name, a-created-object-is-stored-under-its-id, the-scanner-restores-a-name-that-disagrees, a-rename-never-overwrites