---
id: id-and-created-at-immutable
name: Id And Created At Are Immutable
title: Id And Created At Are Immutable
description: An update can never rewrite an object's identity or original creation time.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - checksum-guarded-writes
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
An update MUST reject a changed id with IMMUTABLE_ID and a changed createdAt with IMMUTABLE_CREATED_AT.
## Evidence
src/lib/filesystem.ts:196-199
## Why it matters
A moved or reborn object would break every relation and every stored reference to it.