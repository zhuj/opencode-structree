---
id: doctor-report
name: Doctor Report
title: Doctor Report
description: Observed implementation of Bounded Read-Only Diagnosis.
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
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - diagnosis-never-implies-repair-or-health
  usedIn:
    - doctor-report-api
  commitsTo: []
---
# Doctor Report

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

DoctorReport version 1 separates requestedProbes, per-probe status/coverage/context, safe findings and overall complete/incomplete state. Probe outcomes include ok, findings, blocked, failed and not-checked. Status and coverage describe only selected observed checks; no proposed action is recorded as already applied.

## Traceability

- [[contracts/diagnosis-never-implies-repair-or-health|diagnosis-never-implies-repair-or-health]]
- [[interfaces/doctor-report-api|doctor-report-api]]

## Source Evidence

- implementation: `src/lib/doctor/source.ts`
- implementation: `src/lib/doctor/types.ts`
- implementation: `src/doctor-cli.ts`
- implementation: `src/lib/doctor-mcp.ts`
- test: `test/doctor-core.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
