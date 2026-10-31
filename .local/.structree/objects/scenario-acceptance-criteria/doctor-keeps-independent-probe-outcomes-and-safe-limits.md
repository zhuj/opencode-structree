---
id: doctor-keeps-independent-probe-outcomes-and-safe-limits
name: Bounded Read-Only Diagnosis Observable Boundary
title: Bounded Read-Only Diagnosis Observable Boundary
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
  scenario: diagnose-selected-capabilities-without-repair
  dependsOn: []
---
# Bounded Read-Only Diagnosis Observable Boundary

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Given one failed probe, independent successful outcomes remain in the versioned report. A missing root is not created, inventory counts metadata without exposing source contents, reached bounds qualify coverage, and diagnostic locations/messages exclude unsafe absolute paths. Incomplete requested probes produce exit 3 before complete blocking findings produce exit 2; unselected probes do not force incompleteness.

## Traceability

- [[scenarios/diagnose-selected-capabilities-without-repair|diagnose-selected-capabilities-without-repair]]

## Source Evidence

- implementation: `src/lib/doctor/source.ts`
- implementation: `src/lib/doctor/types.ts`
- implementation: `src/doctor-cli.ts`
- implementation: `src/lib/doctor-mcp.ts`
- test: `test/doctor-core.test.ts`
- documentation: `docs/recovery.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or deployment health.
