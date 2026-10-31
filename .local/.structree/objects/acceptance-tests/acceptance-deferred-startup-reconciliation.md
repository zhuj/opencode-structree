---
id: acceptance-deferred-startup-reconciliation
name: deferred startup reconciliation acceptance
title: "Acceptance: Deferred Startup Reconciliation"
description: The criteria of the deferred startup reconciliation hold.
createdAt: 2026-10-21T11:20:00.000Z
updatedAt: 2026-10-21T11:20:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - the-server-does-not-wait-for-the-startup-reconciliation
    - a-deferred-startup-failure-is-reported-not-fatal
---
## Scenario
resync-index-reconciliation - Resync Index Reconciliation
## Criteria covered
the-server-does-not-wait-for-the-startup-reconciliation, a-deferred-startup-failure-is-reported-not-fatal
## Evidence
test/lifecycle.test.ts, test/cli.test.ts, docs/decisions/0015-defer-the-startup-reconciliation.md