---
id: cli-status
name: CLI Status
title: CLI Status
description: Performs startup reconciliation and prints the current index, sync and embedding status.
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
    - config-never-migrates-objects
    - config-rejects-invalid-settings
  commitsTo:
    - adr-configuration-layering
    - adr-project-local-mcp-registration
---
## Surface
src/cli.ts - the status command.
## Behavior
Performs startup reconciliation and prints the current index, sync and embedding status.
## Guarantees
- The status object is printed as JSON on stdout.
- Startup reconciliation completes before the status is reported.
- The framework is closed before the process exits.