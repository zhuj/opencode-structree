---
id: mcp-tool-surface
name: mcp tools
title: Mcp Tool Surface
description: Exposes registry-generated typed CRUD and shared discovery/search/relations, with application-only materialization, doctor and repair adapters.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:36.964Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/mcp.ts
      role: implementation
    - root: project
      path: src/materialization-server.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  project: structree-initial
  commitment:
    goals:
      - initial-implementation
---
# Mcp Tool Surface

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

The generic library surface registers five CRUD/list tools per definition plus definitions, search, relations, resync and status. With twelve core types this is 65 tools. `src/materialization-server.ts` adds validate/materialize (2), doctor (1), and explicit repair plan/apply/rollback (3), yielding 71 application tools. These are statically inspected registration counts, not a fresh live transport test. Host-selected paths bound adapters; extra application tools are not installed automatically into generic library servers. See [[features/explicit-source-repair|Explicit source repair]] and [[features/bounded-read-only-diagnosis|Doctor]].

## Typed References

- [[projects/structree-initial|structree-initial]]
- [[project-goals/initial-implementation|initial-implementation]]

## Source Evidence

- implementation: `src/lib/mcp.ts`
- implementation: `src/materialization-server.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
