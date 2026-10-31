---
id: vault-confinement-and-size-violations
name: vault violations
title: Vault Confinement And Size Violations
description: Refuses paths that escape the vault, symlinked files, oversized files and invalid UTF-8 content.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - markdown-frontmatter-round-trip
  commitment:
    features:
      - vault-file-object-model
---
## Context
Refuses paths that escape the vault, symlinked files, oversized files and invalid UTF-8 content.

## Expected behaviour
Ordinary files inside the vault root are read and written normally.

## Failure modes
Path escapes, symlinks, oversized files and invalid UTF-8 are refused or excluded with an issue.

## Covered by
vault-rejects-path-escape, vault-rejects-oversized-and-invalid-utf8