---
id: create-requires-unused-id
name: Create Requires An Unused Id
title: Create Requires An Unused Id
description: A new identifier can only be created when the store can prove it is unused.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-identity-key
    - duplicate-identity-excluded
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
Create MUST fail with SOURCE_CONFLICT when the type directory scan is incomplete or reports issues, and MUST fail with ALREADY_EXISTS when the id is already present.
## Evidence
src/lib/filesystem.ts:168-176
## Why it matters
Without a complete scan the store cannot prove that the new id is free.