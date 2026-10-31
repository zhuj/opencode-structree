---
id: sc-model-preparation-failure-not-fatal
name: Sc Model Preparation Failure Not Fatal
title: Sc Model Preparation Failure Not Fatal
description: Shows that a failed preparation is visible and does not take the server down.
createdAt: 2026-10-21T04:40:00.000Z
updatedAt: 2026-10-21T04:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-model-snapshot-preparation
  commitsTo:
    - embedding-provider-interface
    - object-facade
---
## Test
preparing the embeddings calls the provider once and records a failure without hiding it
## File
test/framework.test.ts
## What it proves
Shows that a failed preparation is visible and does not take the server down.
## Criteria
model-preparation-failure-keeps-fulltext-alive