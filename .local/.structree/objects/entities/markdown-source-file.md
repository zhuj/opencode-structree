---
id: markdown-source-file
name: Markdown Source File
title: Markdown Source File
description: The authoritative on-disk file holding one object with its YAML frontmatter and Markdown body.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - source-files-authoritative
    - checksum-covers-whole-file
    - atomic-source-publication
    - id-and-created-at-immutable
  usedIn:
    - vault-api
    - object-facade
    - mcp-object-crud-tools
    - sqlite-index-api
    - mcp-objects-resync
    - search-api
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
    - adr-extract-library-and-adopt-vault
---
## Fields
- frontmatter, body, raw
- path, checksum, json
## Lifecycle
Published atomically by create or update, replaced in full under a checksum guard, and removed by delete; the same file may be edited or renamed externally and is then re-indexed.
## Usage
Read and written through the vault and the object facade, and read back by the index and the resync barrier.