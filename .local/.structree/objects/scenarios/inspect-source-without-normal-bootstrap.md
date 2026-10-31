---
id: inspect-source-without-normal-bootstrap
name: Independent Byte Recovery Workflow
title: Independent Byte Recovery Workflow
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
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - independent-byte-recovery
---
# Independent Byte Recovery Workflow

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

openRecoveryRoot opens an explicitly selected existing root using Bun/standard-library and dependency-free confinement helpers. It does not parse configuration, load registry/YAML/SQLite/MCP/models, scaffold a missing root or repair source. readRange delivers bounded base64 bytes with optional page-only text decoding, returned-byte hash, observed revision and EOF assurance; listDirectory is bounded and nonrecursive. Pages are observations, not an atomic whole-file snapshot. Closing rejects new work and drains owned operations.

## Traceability

- [[projects/structree-initial|structree-initial]]
- [[features/independent-byte-recovery|independent-byte-recovery]]
- [[scenario-acceptance-criteria/recovery-pages-state-exact-bytes-and-observation-limits|recovery-pages-state-exact-bytes-and-observation-limits]]

## Source Evidence

- implementation: `src/lib/recovery/index.ts`
- implementation: `src/lib/recovery/read.ts`
- implementation: `src/recovery-cli.ts`
- test: `test/recovery.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
