---
id: model-snapshots-are-shared-through-the-user-cache
name: model snapshots are shared through the user cache
title: Model Snapshots Are Shared Through The User Cache
description: The default model cache is the global user cache, and the project directory holds no model weights.
createdAt: 2026-10-21T10:40:00.000Z
updatedAt: 2026-10-21T10:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: embedding-provider-failures
  dependsOn: []
---
## Statement
The default model cache directory is the user cache directory joined with "onnx" and "models", the project directory holds no snapshot, and a snapshot in that directory serves every project on the machine.
## How it is observed
A configuration that does not name a cache directory resolves to the user cache, an absolute XDG_CACHE_HOME is honored and a relative one is ignored, and a preparation against the user cache succeeds without a download.