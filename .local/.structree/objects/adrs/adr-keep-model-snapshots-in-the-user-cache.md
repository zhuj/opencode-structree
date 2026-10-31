---
id: adr-keep-model-snapshots-in-the-user-cache
name: keep model snapshots in the user cache
title: Keep Model Snapshots In The User Cache
description: The ONNX snapshot lives in the global user cache and is shared by every project on the machine.
createdAt: 2026-10-21T10:40:00.000Z
updatedAt: 2026-10-21T10:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - embedding-provider-failures
  partOf: null
  dependsOn:
    - adr-prepare-the-model-snapshot-at-startup
---
## Context

The default model cache was a project-relative path inside the project's own state directory, so
every project that used the same pinned model downloaded its own copy of roughly 130 MB, and the
weights sat beside the project's authoritative sources and its derived search index.

## Decision

The snapshots live in the global user cache, at "~/.cache/onnx/models", or at
"$XDG_CACHE_HOME/onnx/models" when that variable holds an absolute path. The user cache directory
is the XDG base directory when it is absolute and the home cache directory otherwise.

An explicit cache directory in a configuration file still wins, and a relative one still resolves
against the project directory. The model cache must still be outside the object directory, and that
is still enforced. The snapshot layout inside the cache, the file verification, the preparation
behavior and the embedding fingerprint are unchanged: the fingerprint covers the provider and the
chunking and never the cache location, so moving a snapshot does not invalidate a vector cache.

## Consequences

One snapshot serves every project on the machine, and the project's own directory no longer holds
the weights. The configuration default is now absolute, so it no longer follows the project
directory. The offline switch keeps its meaning, and a missing snapshot is still reported as
MODEL_NOT_CACHED when nothing may be fetched.