---
id: cache-outside-source-root
name: Cache Lives Outside The Source Root
title: Cache Lives Outside The Source Root
description: Derived state is never written inside the authoritative directory.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-configuration-layering
    - adr-local-state-layout
---
## Rule
The SQLite cache path and the ONNX model cache directory MUST resolve outside the configured object root, and configuration MUST be rejected when either is inside it.
## Evidence
src/lib/config.ts:247-255; src/lib/config.ts:266-267
## Why it matters
A cache file inside the source root would be scanned as if it were source data.