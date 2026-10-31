---
id: mcp-objects-resync
name: MCP Objects Resync
title: MCP Objects Resync
description: Runs the shared reconciliation barrier over all registered source directories.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-facade
  usedBy:
    - index-rebuildable
    - incomplete-scan-no-deletion
  commitsTo:
    - adr-project-local-mcp-registration
    - adr-filesystem-commit-and-reconciliation
---
## Surface
src/lib/mcp.ts - the objects_resync tool.
## Behavior
Runs the shared reconciliation barrier over all registered source directories.
## Guarantees
- The report names the scanned, indexed, unchanged and deleted counts.
- Parse and embedding failures are reported as issues rather than raised.
- The source Markdown files are never modified by the barrier.