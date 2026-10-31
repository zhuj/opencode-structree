---
id: byte-pages-do-not-authorize-whole-file-overwrite
name: Independent Byte Recovery Contract
title: Independent Byte Recovery Contract
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
  commitsTo: []
---
# Independent Byte Recovery Contract

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

openRecoveryRoot opens an explicitly selected existing root using Bun/standard-library and dependency-free confinement helpers. It does not parse configuration, load registry/YAML/SQLite/MCP/models, scaffold a missing root or repair source. readRange delivers bounded base64 bytes with optional page-only text decoding, returned-byte hash, observed revision and EOF assurance; listDirectory is bounded and nonrecursive. Pages are observations, not an atomic whole-file snapshot. Closing rejects new work and drains owned operations.

## Traceability



## Source Evidence

- implementation: `src/lib/recovery/index.ts`
- implementation: `src/lib/recovery/read.ts`
- implementation: `src/recovery-cli.ts`
- test: `test/recovery.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
