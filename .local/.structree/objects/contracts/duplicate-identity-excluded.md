---
id: duplicate-identity-excluded
name: Duplicate Identity Excluded
title: Duplicate Identity Excluded
description: Files that share an identity are reported and kept out of the index.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-identity-key
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
When several files provide the same type and id pair, the implementation MUST report a DUPLICATE_ID issue for each and MUST exclude all conflicting copies from indexing.
## Evidence
src/lib/filesystem.ts:113-133
## Why it matters
An ambiguous identity cannot be indexed without picking an arbitrary winner.