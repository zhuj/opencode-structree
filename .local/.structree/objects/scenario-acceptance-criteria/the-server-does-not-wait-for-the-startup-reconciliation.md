---
id: the-server-does-not-wait-for-the-startup-reconciliation
name: the server does not wait for the startup reconciliation
title: The Server Does Not Wait For The Startup Reconciliation
description: The MCP server answers requests while the first reconciliation is still running.
createdAt: 2026-10-21T11:20:00.000Z
updatedAt: 2026-10-21T11:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: resync-index-reconciliation
  dependsOn: []
---
## Statement
The MCP server begins the startup reconciliation and answers requests while it runs. The diagnostic command waits, and the library's default still waits.
## How it is observed
A status call issued right after the server starts reports that a synchronization is in progress and that no completed report exists yet, and the startup later completes with the expected object count.