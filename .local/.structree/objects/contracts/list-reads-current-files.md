---
id: list-reads-current-files
name: List Reads Current Files
title: List Reads Current Files
description: Lists source-backed readable documents with explicit completeness rather than hiding partial coverage.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:38.940Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/source-access/list.ts
      role: implementation
    - root: project
      path: src/lib/source-access/index.ts
      role: implementation
    - root: project
      path: src/lib/types.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-redacted-client-diagnostics
---
# List Reads Current Files

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

List reads current filesystem documents in identifier order with limit 1..1000 and nonnegative offset. It includes readable partial documents. Complete discovery returns numeric total and complete:true; incomplete discovery returns complete:false, total:null, observedCount, safe issues and continuation over observed unique documents. Null continuation under incomplete coverage is not proof of absence. Duplicate identities are excluded rather than arbitrarily chosen. Reduced lists omit body and partial raw. This replaces the historical all-or-nothing SCAN statement; real failures may still reject when no usable result can be produced.

## Typed References

- [[adrs/adr-redacted-client-diagnostics|adr-redacted-client-diagnostics]]

## Source Evidence

- implementation: `src/lib/source-access/list.ts`
- implementation: `src/lib/source-access/index.ts`
- implementation: `src/lib/types.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
