---
id: model-preparation-failure-keeps-fulltext-alive
name: Model Preparation Failure Keeps Fulltext Alive
title: Model Preparation Failure Keeps Fulltext Alive
description: Explicit preparation failure is recorded without making readable source/fulltext unavailable; normal serve does not prepare.
createdAt: 2026-10-21T04:40:00.000Z
updatedAt: 2026-10-28T10:21:41.346Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/cli.ts
      role: implementation
    - root: project
      path: src/lib/framework.ts
      role: implementation
    - root: project
      path: src/lib/source-access/search-operation.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  scenario: embedding-provider-failures
  dependsOn: []
---
# Model Preparation Failure Keeps Fulltext Alive

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

On direct ObjectFramework, prepareEmbeddings records and rethrows a failure; the explicit sync host catches it and continues its report path. Normal serve never prepares models and isolates optional capabilities. Direct semantic provider failure and wrapper source fallback are distinct outcomes: wrapper matching reports mode:"source", not semantic success. No preparation or test execution was performed during this refresh.

## Typed References

- [[scenarios/embedding-provider-failures|embedding-provider-failures]]

## Source Evidence

- implementation: `src/cli.ts`
- implementation: `src/lib/framework.ts`
- implementation: `src/lib/source-access/search-operation.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
