---
id: sc-lifecycle-close-drains
name: close drains every embedding worker before disposing the provider or database
title: Close Drains Embedding Workers
description: Shows that shutdown completes pending embedding work before disposing resources.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-lock-timeout-and-cancellation
  commitsTo:
    - object-facade
    - framework-lifecycle-events
---
## Test
close drains every embedding worker before disposing the provider or database
## File
test/lifecycle.test.ts
## What it proves
Shows that shutdown completes pending embedding work before disposing resources.
## Criteria
lock-cancels-queued-waiter