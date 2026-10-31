---
id: cli-serve
name: CLI Serve
title: CLI Serve
description: Serves source-first MCP before optional projection readiness and bootstraps only the application-selected default layout.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-28T10:21:37.434Z
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
relations:
  partOf: null
  dependsOn:
    - config-loader-api
    - object-facade
    - mcp-server-factory
  usedBy:
    - config-never-migrates-objects
    - config-rejects-invalid-settings
  commitsTo:
    - adr-configuration-layering
    - adr-project-local-mcp-registration
---
# CLI Serve

Last refreshed: 2026-10-28. Stable identity and original creation timestamp retained.

## Current Behavior

Serve loads explicit or default layered configuration, then composes source access with supervised optional projection startup. It does not wait for optional readiness or prepare models. cwd-relative .local/.structree is created; an absent .gitignore is exclusively written, while any existing file is preserved. Only the exact selected cwd-relative default source root is created; missing custom roots remain errors. EOF/signals close the transport and owned runtime. Config/registry failures still require the explicitly rooted independent recovery entry, not guessed roots. See [[interfaces/source-access-runtime-api|Source-access runtime]].

## Typed References

- [[interfaces/config-loader-api|config-loader-api]]
- [[interfaces/object-facade|object-facade]]
- [[interfaces/mcp-server-factory|mcp-server-factory]]
- [[contracts/config-never-migrates-objects|config-never-migrates-objects]]
- [[contracts/config-rejects-invalid-settings|config-rejects-invalid-settings]]
- [[adrs/adr-configuration-layering|adr-configuration-layering]]
- [[adrs/adr-project-local-mcp-registration|adr-project-local-mcp-registration]]

## Source Evidence

- implementation: `src/cli.ts`
- implementation: `src/lib/resilient-runtime.ts`
- documentation: `docs/recovery.md`

This refresh uses static source evidence; no tests, runtime recovery or model operations were run. Historical decision rationale is not newly invented or retroactively approved.
