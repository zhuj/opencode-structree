---
id: doctor-report-api
name: Bounded Read-Only Diagnosis API
title: Bounded Read-Only Diagnosis API
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
  dependsOn:
    - recovery-reader-api
  usedBy:
    - diagnosis-never-implies-repair-or-health
  commitsTo: []
---
# Bounded Read-Only Diagnosis API

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

runDoctorReport runs selected bounded independent probes, defaulting to root and metadata inventory. Requested but unavailable checks are blocked; unselected checks are not-checked. Reports retain useful independent outcomes, controlled safe findings and coverage limits. Doctor is diagnosis-only: no framework/database initialization, source repair, model preparation or execution of generated modules. Optional configuration/cache/materialization checks have intentionally qualified coverage, not broad runtime readiness or cache-integrity certification.

## Traceability

- [[contracts/diagnosis-never-implies-repair-or-health|diagnosis-never-implies-repair-or-health]]
- [[interfaces/recovery-reader-api|recovery-reader-api]]

## Source Evidence

- implementation: `src/lib/doctor/source.ts`
- implementation: `src/lib/doctor/types.ts`
- implementation: `src/doctor-cli.ts`
- implementation: `src/lib/doctor-mcp.ts`
- test: `test/doctor-core.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
