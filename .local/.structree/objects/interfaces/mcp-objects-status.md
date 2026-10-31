---
id: mcp-objects-status
name: MCP Objects Status
title: MCP Objects Status
description: Reports the selected facade status, distinguishing source readability/capability readiness from full framework index diagnostics.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:37.573Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/source-access/index.ts
      role: implementation
    - root: project
      path: src/lib/framework.ts
      role: implementation
    - root: project
      path: src/lib/mcp.ts
      role: implementation
    - root: project
      path: docs/recovery.md
      role: documentation
relations:
  partOf: null
  dependsOn:
    - object-facade
  usedBy:
    - index-rebuildable
    - embedding-fingerprint-invalidation
  commitsTo:
    - adr-project-local-mcp-registration
    - adr-redacted-client-diagnostics
    - adr-search-query-and-availability-guidance
---
# MCP Objects Status

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

`objects_status` delegates to facade.status(). On normal source-first serve this reports sourceAvailable, source:"read-only", capability readiness and any bounded sourceRecovery outcome. source:"read-only" describes only the independent reader: ready delegates still accept typed mutations. It is not a global denial of writes. A direct ObjectFramework/maintenance status additionally exposes index/sync/provider metadata and bounded issue summaries. Those fields are not promised by every facade. Neither surface runs model inference or certifies future readiness, complete discovery or applied repair. See [[entities/source-capability-state|Capability state]].

## Typed References

- [[interfaces/object-facade|object-facade]]
- [[contracts/index-rebuildable|index-rebuildable]]
- [[contracts/embedding-fingerprint-invalidation|embedding-fingerprint-invalidation]]
- [[adrs/adr-project-local-mcp-registration|adr-project-local-mcp-registration]]
- [[adrs/adr-redacted-client-diagnostics|adr-redacted-client-diagnostics]]
- [[adrs/adr-search-query-and-availability-guidance|adr-search-query-and-availability-guidance]]

## Source Evidence

- implementation: `src/lib/source-access/index.ts`
- implementation: `src/lib/framework.ts`
- implementation: `src/lib/mcp.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
