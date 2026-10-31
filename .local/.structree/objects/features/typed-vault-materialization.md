---
id: typed-vault-materialization
name: Typed Vault Materialization
title: Typed Vault Materialization
description: Observed implementation of Typed Vault Materialization.
createdAt: 2026-10-28T10:17:17.157Z
updatedAt: 2026-10-28T10:17:17.157Z
retiredAt: null
tags:
  basis: observed-implementation
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/materialization/index.ts
      role: implementation
    - root: project
      path: src/lib/materialization/validate.ts
      role: implementation
    - root: project
      path: src/lib/model/index.ts
      role: implementation
    - root: project
      path: test/materialization.test.ts
      role: test
    - root: project
      path: docs/materialization.md
      role: documentation
relations:
  project: structree-initial
  commitment:
    goals: []
---
# Typed Vault Materialization

Last refreshed: 2026-10-28. Recorded from current source, not a newly approved requirement or a test execution claim.

## Observed Contract

Source-backed validation checks complete schemas, identities, typed relations and explicit file bindings before deterministic data-only TypeScript projection. Check mode reports missing/changed output without writing. Partial inputs remain inspectable but prevent strict publication. Owned output checks refuse edited or handwritten files; write-mode publication is per file with the manifest last, not a whole-directory transaction. No framework, index initialization, model preparation or generated-code execution is needed.

## Traceability

- [[projects/structree-initial|structree-initial]]
- [[scenarios/validate-and-materialize-vault|validate-and-materialize-vault]]

## Source Evidence

- implementation: `src/lib/materialization/index.ts`
- implementation: `src/lib/materialization/validate.ts`
- implementation: `src/lib/model/index.ts`
- test: `test/materialization.test.ts`
- documentation: `docs/materialization.md`

## Verification Limits

Source and test assertions were inspected. Tests were not run during this documentation refresh. Structural links do not prove runtime behavior or snapshot freshness.
