---
id: recovery-pages-state-exact-bytes-and-observation-limits
name: Independent Byte Recovery Observable Boundary
title: Independent Byte Recovery Observable Boundary
description: Observed implementation of Independent Byte Recovery.
createdAt: 2026-10-28T10:19:04.886Z
updatedAt: 2026-10-28T10:19:04.886Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/recovery/index.ts
      role: implementation
    - root: project
      path: src/lib/recovery/read.ts
      role: implementation
    - root: project
      path: src/recovery-cli.ts
      role: implementation
    - root: project
      path: test/recovery.test.ts
      role: test
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  scenario: inspect-source-without-normal-bootstrap
  dependsOn: []
---
# Independent Byte Recovery Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given a file with malformed metadata and native case/colon spelling, a selected range returns exactly the requested byte slice with nextOffset, page-only hash scope and no implicit text decoding. Given a missing root, opening fails without scaffolding. A page checksum is never presented as authorization to replace a full file.

## Traceability

- [[scenarios/inspect-source-without-normal-bootstrap|inspect-source-without-normal-bootstrap]]

## Source Evidence

- implementation: `src/lib/recovery/index.ts`
- implementation: `src/lib/recovery/read.ts`
- implementation: `src/recovery-cli.ts`
- test: `test/recovery.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
