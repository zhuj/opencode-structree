---
id: sc-independent-byte-recovery
name: Independent Byte Recovery Scenario Evidence
title: Independent Byte Recovery Scenario Evidence
description: Source-inspected test evidence for Independent Byte Recovery.
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
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-independent-byte-recovery
  commitsTo:
    - recovery-reader-api
---
# Independent Byte Recovery Scenario Evidence

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

test/recovery.test.ts contains "returns exact bounded bytes despite malformed metadata and native colon/case spelling" and "does not scaffold a missing root". Assertions compare decoded base64 with the exact original byte slice, check returned-bytes hash scope and verify no directory was created.

## Traceability

- [[acceptance-tests/acceptance-independent-byte-recovery|acceptance-independent-byte-recovery]]
- [[interfaces/recovery-reader-api|recovery-reader-api]]

## Source Evidence

- implementation: `src/lib/recovery/index.ts`
- implementation: `src/lib/recovery/read.ts`
- implementation: `src/recovery-cli.ts`
- test: `test/recovery.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
