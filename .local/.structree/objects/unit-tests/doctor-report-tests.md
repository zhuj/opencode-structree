---
id: doctor-report-tests
name: Bounded Read-Only Diagnosis Test Suite
title: Bounded Read-Only Diagnosis Test Suite
description: Source-inspected test evidence for Bounded Read-Only Diagnosis.
createdAt: 2026-10-28T10:19:04.886Z
updatedAt: 2026-10-28T10:19:04.886Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/doctor/source.ts
      role: implementation
    - root: project
      path: src/lib/doctor/types.ts
      role: implementation
    - root: project
      path: src/doctor-cli.ts
      role: implementation
    - root: project
      path: src/lib/doctor-mcp.ts
      role: implementation
    - root: project
      path: test/doctor-core.test.ts
      role: test
    - root: project
      path: docs/recovery.md
      role: documentation
  execution: not-run-during-refresh
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-bounded-read-only-diagnosis
  commitsTo:
    - doctor-report
---
# Bounded Read-Only Diagnosis Test Suite

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

test/doctor-core.test.ts asserts noncreation of absent roots, metadata-only inventory, independent probe results, incomplete exit precedence, blocked unavailable probes, redacted unsafe paths, bounded entry/directory inventory and cooperative cancellation.

## Traceability

- [[scenario-tests/sc-bounded-read-only-diagnosis|sc-bounded-read-only-diagnosis]]
- [[entities/doctor-report|doctor-report]]

## Source Evidence

- implementation: `src/lib/doctor/source.ts`
- implementation: `src/lib/doctor/types.ts`
- implementation: `src/doctor-cli.ts`
- implementation: `src/lib/doctor-mcp.ts`
- test: `test/doctor-core.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
