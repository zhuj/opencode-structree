---
id: source-repair-plan
name: Source Repair Plan
title: Source Repair Plan
description: Observed implementation of Explicit Source Repair.
createdAt: 2026-10-28T10:19:46.863Z
updatedAt: 2026-10-28T10:19:46.863Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/source-repair/session.ts
      role: implementation
    - root: project
      path: src/lib/source-repair/apply.ts
      role: implementation
    - root: project
      path: src/repair-cli.ts
      role: implementation
    - root: project
      path: src/lib/source-repair-mcp.ts
      role: implementation
    - root: project
      path: test/source-repair-core.test.ts
      role: test
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn:
    - markdown-source-file
  usedBy:
    - source-repair-never-reconstructs-source-from-recovered-json
  usedIn:
    - source-repair-session-api
  commitsTo: []
---
# Source Repair Plan

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

A source repair plan is inert versioned data with operation, action ID, relative paths, whole-byte before/after checksums, size and canonical base64 payload. The action ID binds mutation fields but is neither an authentication signature nor consent. Apply consumes a validated owned plan plus a separate approval object; recovered metadata alone is not a replacement payload.

## Traceability

- [[contracts/source-repair-never-reconstructs-source-from-recovered-json|source-repair-never-reconstructs-source-from-recovered-json]]
- [[interfaces/source-repair-session-api|source-repair-session-api]]
- [[entities/markdown-source-file|markdown-source-file]]

## Source Evidence

- implementation: `src/lib/source-repair/session.ts`
- implementation: `src/lib/source-repair/apply.ts`
- implementation: `src/repair-cli.ts`
- implementation: `src/lib/source-repair-mcp.ts`
- test: `test/source-repair-core.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
