---
id: cli-sync-and-status-commands
name: cli commands
title: Cli Sync And Status Commands
description: Prints the index status and the sync report as JSON and derives the process exit code from the reported issues.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - cli-commands-and-serve
---
## Context
Prints the index status and the sync report as JSON and derives the process exit code from the reported issues.

## Expected behaviour
The status and sync commands write JSON documents describing the index and the last reconciliation.

## Failure modes
Reported source issues make the sync command exit with code 2.

## Covered by
cli-status-prints-json-state, cli-sync-exit-code-reflects-issues