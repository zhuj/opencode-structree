---
id: adr-revision-identity-follows-source-collation
name: Revision identity follows source collation
title: Revision Identity Follows Source Collation
description: The prepared-mutation revision table uses the source key column's collation, so every spelling that resolves to the same row is guarded by the same revision counter.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - serialized-cross-process-writes
      - resync-index-reconciliation
      - agent-tool-surface-sweep
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's session memory in `.local/.memory/lessons/20261020-064501-revision-identity-must-match-source-identity.md`. The prepared-mutation layer protects changes with a persistent revision counter so that a change computed against an earlier state cannot commit after another writer changed the row, but the revision table was created as `id TEXT PRIMARY KEY`, which uses BINARY comparison, while a source key column may legitimately declare `COLLATE NOCASE`. The defect was observed at commit `ed94d404` on 2026-10-19 and fixed on 2026-10-20.

## Decision
The revision table now uses the source key column's collation, so every spelling that resolves to the same row shares one revision, and an existing revision table written with binary comparison is migrated in place, keeping the highest revision per identity before the triggers are recreated. A preparation made under an alternate spelling is rejected with `MutationConflictError` after a concurrent write. The fix was applied and verified on 2026-10-20.

## Consequences
- The lost-update guard is strict instead of silent, and a concurrent write to one spelling is now detected by a preparation made under another spelling, as are deletions and recreations.
- The framework's own object keys use BINARY comparison, so the exposure had been limited to host-defined tables with a case-insensitive key.
- An existing revision table requires an in-place migration that keeps the highest revision per identity, which a host must plan for rather than inherit as a side effect of an unrelated edit.
- A suspected write window during that migration was refuted by measurement, because the migration runs inside an immediate transaction so a concurrent writer blocks instead of slipping through.

## Evidence
- `.local/.memory/lessons/20261020-064501-revision-identity-must-match-source-identity.md`
- `src/lib/sqlite/prepared-mutation.ts` and `src/lib/sqlite/index-table.ts`
- `.local/.progress/2026-10-19-1527-review-2.md`, `.local/.progress/2026-10-19-1527-review-evidence-2.json` and commit `96a3f93`