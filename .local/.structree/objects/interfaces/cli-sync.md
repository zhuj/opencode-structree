---
id: cli-sync
name: CLI Sync
title: CLI Sync
description: Reconciles the derived index against all registered Markdown directories and exits.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - config-loader-api
    - object-facade
  usedBy:
    - index-rebuildable
    - config-never-migrates-objects
    - config-rejects-invalid-settings
  commitsTo:
    - adr-configuration-layering
    - adr-project-local-mcp-registration
---
## Surface
src/cli.ts - the sync command.
## Behavior
Reconciles the derived index against all registered Markdown directories and exits.
## Guarantees
- The last sync report is printed as JSON on stdout.
- Exit code 2 signals that the report contains issues.
- The framework is closed before the process exits.