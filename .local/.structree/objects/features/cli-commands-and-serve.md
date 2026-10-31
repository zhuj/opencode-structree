---
id: cli-commands-and-serve
name: cli commands
title: Cli Commands And Serve
description: Routes normal service, maintenance, validation/materialization, graph analysis, doctor and repair commands with distinct side-effect boundaries.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:36.849Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/cli.ts
      role: implementation
    - root: project
      path: src/lib/resilient-runtime.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
    - root: project
      path: docs/materialization.md
      role: documentation
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
# Cli Commands And Serve

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

`src/cli.ts` routes serve, sync, status, validate, materialize, lookup, impact, coverage, diagram, diff, doctor and repair. Independent recovery and repair entries remain available. No --config selects built-in defaults plus the optional local override, not an implicit JSON file. Serve creates only its local state and the exact selected default objects root, preserving an existing .gitignore. It uses source-first resilient access with a projection delegate and no model preparation. Explicit sync/status use maintenance reconciliation and disable watching; only sync prepares embeddings. See [[features/resilient-source-access|Resilient source access]] and [[features/typed-vault-materialization|Typed materialization]].

## Typed References

- [[projects/structree-initial|structree-initial]]
- [[project-goals/initial-implementation|initial-implementation]]

## Source Evidence

- implementation: `src/cli.ts`
- implementation: `src/lib/resilient-runtime.ts`
- documentation: `docs/recovery.md`
- documentation: `docs/materialization.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
