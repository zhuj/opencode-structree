---
id: mcp-objects-search
name: MCP Objects Search
title: MCP Objects Search
description: Accepts fulltext/semantic/hybrid requests and distinguishes indexed ranking from explicitly degraded source matching.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:38.701Z
retiredAt: null
tags: {}
metadata:
  reviewedHead: 7a507b1b65338daae338ec6c1fb83d5fbff8dfd2
  fileBindings:
    - root: project
      path: src/lib/source-access/search-operation.ts
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
    - search-api
  usedBy:
    - search-hits-revalidated
    - search-bounds-enforced
  commitsTo:
    - adr-project-local-mcp-registration
    - adr-flat-search-namespace
    - adr-search-query-and-availability-guidance
    - adr-fulltext-search-excerpts
---
# MCP Objects Search

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

Indexed ObjectFramework search returns its actual requested ranking mode and numeric generation, revalidates source checksums, and can expose bounded lexical excerpts independently of includeBody. Semantic/hybrid provider failure remains an error on that direct framework boundary. Normal source-first composition validates requests, then falls back when startup/index readiness/provider search fails, returning mode:"source", requestedMode, null generation/ranks and coverage/recovery diagnostics. That is not a successful semantic or BM25 query and is not silent fallback. Invalid requests/cancellation still fail. Search is bounded and nonexhaustive; paginate source lists to establish inventory. See [[interfaces/source-access-runtime-api|Source access]].

## Typed References

- [[interfaces/object-facade|object-facade]]
- [[interfaces/search-api|search-api]]
- [[contracts/search-hits-revalidated|search-hits-revalidated]]
- [[contracts/search-bounds-enforced|search-bounds-enforced]]
- [[adrs/adr-project-local-mcp-registration|adr-project-local-mcp-registration]]
- [[adrs/adr-flat-search-namespace|adr-flat-search-namespace]]
- [[adrs/adr-search-query-and-availability-guidance|adr-search-query-and-availability-guidance]]
- [[adrs/adr-fulltext-search-excerpts|adr-fulltext-search-excerpts]]

## Source Evidence

- implementation: `src/lib/source-access/search-operation.ts`
- implementation: `src/lib/framework.ts`
- implementation: `src/lib/mcp.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
