---
id: sc-vault-symlink-escape
name: strict logical paths, directory symlinks, and file symlinks cannot escape the vault
title: Symlinks Cannot Escape Vault
description: Shows that logical path escapes and symlinks are refused.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-vault-confinement-and-size-violations
  commitsTo:
    - vault-api
---
## Test
strict logical paths; directory symlinks; and file symlinks cannot escape the vault
## File
test/vault.test.ts
## What it proves
Shows that logical path escapes and symlinks are refused.
## Criteria
vault-rejects-path-escape