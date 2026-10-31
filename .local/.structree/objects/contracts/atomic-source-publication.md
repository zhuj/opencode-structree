---
id: atomic-source-publication
name: Atomic Source Publication
title: Atomic Source Publication
description: A source file is replaced atomically, never half written.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-extract-library-and-adopt-vault
---
## Rule
A write MUST stage a complete temporary file in the destination directory, fsync it, verify its payload and only then replace the destination, and MUST clean up only its own temporary name.
## Evidence
src/lib/vault/owned-stage.ts:29-62; README.md:262
## Why it matters
A reader must never observe a truncated object file.