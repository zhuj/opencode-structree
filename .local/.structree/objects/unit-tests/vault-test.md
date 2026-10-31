---
id: vault-test
name: vault.test.ts
title: Vault Test
description: Covers Markdown codec strictness, staged writes, checksum expectations, confinement and cleanup semantics.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-markdown-round-trip
    - sc-vault-symlink-escape
    - sc-vault-invalid-utf8
  commitsTo:
    - markdown-source-file
    - sync-issue
    - configuration-layer
---
## File
test/vault.test.ts
## What it covers
round-trips an injected Effect header and exact Markdown body | strict header validation rejects missing and excess fields without creating a file | unpaired body and path surrogates fail before publication while escaped header values survive | checksum replacement preserves mode and rejects stale updates and deletes | two local writers cannot both consume the same checksum | no-clobber creation preserves a preexisting destination | a stage rechecks current bytes at publication and belongs to only its creating vault | a removed predecessor is a checksum conflict | the BOM and CRLF source bytes participate in the checksum | duplicate YAML keys and alias expansion remain strict | invalid UTF-8 and oversized files are preserved and excluded with issues | a malformed document is isolated while an unreadable directory marks the snapshot incomplete | strict logical paths; directory symlinks; and file symlinks cannot escape the vault | hidden files; staging names and other extensions are excluded from walks | substituted stage names survive cleanup and cannot be published | tampering with the owned stage content fails before publication | stage parent replacement cannot redirect publication or cleanup | shutdown waits for owned stage cleanup and rejects new capabilities | portable confinement supports normal writes and preserves substituted parents on cleanup | an aborted publication preserves existing bytes and removes its stage
## Verifies
markdown-frontmatter-round-trip, vault-confinement-and-size-violations, serialized-cross-process-writes
## Exercises
markdown-source-file, sync-issue, configuration-layer