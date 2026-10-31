---
id: checksum-guarded-writes
name: Checksum Guarded Writes
title: Checksum Guarded Writes
description: Updates and deletes are guarded by the checksum of the revision they replace.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - checksum-covers-whole-file
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
An update or a delete MUST require the current checksum and MUST fail with CHECKSUM_CONFLICT when the stored checksum differs from the supplied expected checksum.
## Evidence
src/lib/filesystem.ts:200-203; src/lib/filesystem.ts:215-218
## Why it matters
The guard stops a slow client from overwriting a newer revision it never read.