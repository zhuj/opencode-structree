---
id: acceptance-lock-timeout-and-cancellation
name: lock timeout acceptance
title: "Acceptance: Lock Timeout And Cancellation"
description: The scenario lock-timeout-and-cancellation is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - lock-times-out-with-lock-timeout
    - lock-cancels-queued-waiter
---
## Scenario
lock-timeout-and-cancellation - Lock Timeout And Cancellation
## Criteria covered
lock-times-out-with-lock-timeout, lock-cancels-queued-waiter
## Evidence
test/lifecycle.test.ts, test/process-lock.test.ts