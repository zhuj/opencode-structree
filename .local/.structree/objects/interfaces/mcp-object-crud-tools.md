---
id: mcp-object-crud-tools
name: MCP Object CRUD Tools
title: MCP Object CRUD Tools
description: Registers five generated tools per registered object type.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-registry
    - mcp-input-repair-boundary
  usedBy:
    - source-files-authoritative
    - object-identity-key
    - id-and-created-at-immutable
    - checksum-guarded-writes
    - create-requires-unused-id
    - duplicate-identity-excluded
    - delete-removes-derived-data
    - list-reads-current-files
  commitsTo:
    - adr-project-local-mcp-registration
    - adr-repair-mcp-inputs-before-validation
---
## Surface
src/lib/mcp.ts - the _create, _get, _update, _delete and _list tool family, generated per registered type.
## Behavior
Registers five generated tools per registered object type.
## Guarantees
- Input is validated before any mutation is attempted.
- Update and delete require the current checksum of the revision they replace.
- Every tool returns the stored object shape with type, object, body, path and checksum.