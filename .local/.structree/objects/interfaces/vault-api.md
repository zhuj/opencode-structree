---
id: vault-api
name: Vault API
title: Vault API
description: Provides a generic Markdown vault with an injected header codec and no object-schema or SQLite dependency.
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
    - checksum-guarded-writes
    - checksum-covers-whole-file
    - unknown-fields-rejected
    - atomic-source-publication
  commitsTo:
    - adr-extract-library-and-adopt-vault
    - adr-filesystem-commit-and-reconciliation
---
## Surface
src/lib/vault/index.ts - Vault, MarkdownCodec, ConfinedFilesystem, OwnedStage, FileWatcher, WatchLifecycle and reconcileSnapshot.
## Behavior
Provides a generic Markdown vault with an injected header codec and no object-schema or SQLite dependency.
## Guarantees
- The header codec is injected, so any frontmatter shape can be stored.
- Body whitespace and the original file bytes are preserved.
- Publication uses an owned temporary file that is verified before it replaces the destination.