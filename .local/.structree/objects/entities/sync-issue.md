---
id: sync-issue
name: Sync Issue
title: Sync Issue
description: A per-path problem found while scanning sources or computing embeddings.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  usedBy:
    - incomplete-scan-no-deletion
    - confirmed-conflict-invalidates
    - duplicate-identity-excluded
  usedIn:
    - object-facade
    - sqlite-index-api
    - mcp-objects-resync
    - mcp-objects-status
    - cli-sync
    - framework-lifecycle-events
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
    - adr-redacted-client-diagnostics
---
## Fields
- path
- code
- message
## Lifecycle
Produced by a scan or an embedding failure, replaced wholesale at the end of each reconciliation, and reported through the resync report, the status and the CLI exit code.
## Usage
Collected by the reconciliation and surfaced by the resync, status and sync interfaces.