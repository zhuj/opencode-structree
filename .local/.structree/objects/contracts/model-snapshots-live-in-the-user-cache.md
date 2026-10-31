---
id: model-snapshots-live-in-the-user-cache
name: model snapshots live in the user cache
title: Model Snapshots Live In The User Cache
description: The verified model snapshot is kept in the global user cache and shared by every project on the machine.
createdAt: 2026-10-21T10:40:00.000Z
updatedAt: 2026-10-21T10:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-keep-model-snapshots-in-the-user-cache
---
## Rule
The default model cache directory MUST be the user cache directory joined with "onnx" and "models". The user cache directory MUST be XDG_CACHE_HOME when that variable holds an absolute path, and the home cache directory otherwise; a relative XDG_CACHE_HOME MUST be ignored.

An explicit cache directory in a configuration file MUST win, and a relative one MUST still resolve against the project directory. The model cache MUST still be outside the object directory, and that MUST still be enforced.

The snapshot layout, the file verification, the preparation behavior and the embedding fingerprint MUST NOT change. The fingerprint covers the provider and the chunking and never the cache location, so a snapshot that moves does not invalidate a vector cache.

## Why it matters
A pinned model is the same model for every project, and a hundred and thirty megabytes per project is a cost that the machine, not the project, should carry once.

## Evidence
test/config.test.ts, test/embeddings.test.ts, and a live preparation and inference against the snapshot in the user cache on 2026-10-21