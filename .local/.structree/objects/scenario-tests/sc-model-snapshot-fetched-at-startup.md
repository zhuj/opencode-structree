---
id: sc-model-snapshot-fetched-at-startup
name: Sc Model Snapshot Fetched At Startup
title: Sc Model Snapshot Fetched At Startup
description: Shows that the preparation fetches what is missing, refuses when it must, and costs nothing when the snapshot is already there.
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
    - embedding-provider-factory
    - embedding-provider-interface
---
## Test
a complete snapshot is used with no network request, a missing snapshot is refused when downloads are not permitted, and the provider fetches the missing files when they are
## File
test/embeddings.test.ts, test/config.test.ts
## What it proves
Shows that the preparation fetches what is missing, refuses when it must, and costs nothing when the snapshot is already there.
## Criteria
model-snapshot-is-fetched-at-startup