---
id: sc-model-snapshot-user-cache
name: resolves the model cache to the user cache and keeps the fingerprint
title: Resolves The Model Cache To The User Cache
description: Shows that the snapshot lives in the user cache and that moving it does not change the fingerprint.
createdAt: 2026-10-21T10:40:00.000Z
updatedAt: 2026-10-21T10:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-model-snapshot-user-cache
  commitsTo:
    - embedding-provider-factory
    - config-loader-api
---
## Test
resolves the model cache to the user cache and keeps the fingerprint
## File
test/config.test.ts, test/embeddings.test.ts
## What it proves
The default cache directory is the user cache, the environment is read when the configuration is loaded, an explicit directory still wins, and the embedding fingerprint is the same wherever the snapshot lives.
## Criteria
model-snapshots-are-shared-through-the-user-cache