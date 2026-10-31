---
id: sc-deferred-startup-reconciliation
name: answers while the startup reconciliation is still running
title: Answers While The Startup Reconciliation Is Still Running
description: Shows that the server answers during the first pass and that the diagnostic still waits for it.
createdAt: 2026-10-21T11:20:00.000Z
updatedAt: 2026-10-21T11:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-deferred-startup-reconciliation
  commitsTo:
    - mcp-object-crud-tools
    - mcp-objects-status
---
## Test
answers while the startup reconciliation is still running
## File
test/lifecycle.test.ts, test/cli.test.ts
## What it proves
A request that arrives during the first pass is answered, the status reports the pending synchronization, the startup then completes with the expected object count, and a startup failure is reported without stopping the server.
## Criteria
the-server-does-not-wait-for-the-startup-reconciliation, a-deferred-startup-failure-is-reported-not-fatal