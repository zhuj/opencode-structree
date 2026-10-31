---
id: recovery-byte-page
name: Recovery Byte Page
title: Recovery Byte Page
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
  partOf: null
  dependsOn: []
  usedBy:
    - byte-pages-do-not-authorize-whole-file-overwrite
  usedIn:
    - recovery-reader-api
  commitsTo: []
---
# Recovery Byte Page

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

A ReadPage carries base64 bytes, offsets, optional text decoding, pageHash scoped to returned bytes, observed revision/provenance, snapshot:false, diagnostics and observed-end/not-reached/unknown EOF. Revision and page hashes express observations, not a locked whole-file revision or complete semantic validity.

## Traceability

- [[contracts/byte-pages-do-not-authorize-whole-file-overwrite|byte-pages-do-not-authorize-whole-file-overwrite]]
- [[interfaces/recovery-reader-api|recovery-reader-api]]

## Source Evidence

- implementation: `src/lib/recovery/index.ts`
- implementation: `src/lib/recovery/read.ts`
- implementation: `src/recovery-cli.ts`
- test: `test/recovery.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
