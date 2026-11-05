---
id: checksum-guarded-writes
name: Checksum Guarded Writes
title: Checksum Guarded Writes
description: Checksum verification on update/delete is optional via writes.checksumGuard; when enabled, mismatches fail with CHECKSUM_CONFLICT.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-11-05T12:10:00.000Z
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
When `writes.checksumGuard` is enabled, an update or a delete MUST require the current checksum and MUST fail with CHECKSUM_CONFLICT when the stored checksum differs from the supplied expected checksum. When the guard is disabled (the default since the 2026-11-05 owner decision), supplied checksums are accepted without verification: the filesystem is authoritative and the host agent may edit vault files directly, so last-writer-wins is the accepted behavior, and fresh checksums are still returned in every response. The expectedChecksum field stays in all input schemas either way.
## Evidence
src/lib/filesystem.ts FileStore.update and FileStore.delete checksumGuard gates; src/lib/config.ts writes.checksumGuard default false; work item work-2f79e647-8843-4c02-9a56-fc5b6948bc5c records the owner decision.
## Why it matters
The guard stops a slow client from overwriting a newer revision it never read. The owner disabled it by default because the mandatory guard produced CHECKSUM_CONFLICT friction in normal agent workflows where the host edits files directly; enabling the flag restores stale-write protection where it is wanted.