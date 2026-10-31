---
id: partial-scan-preserves-cache
name: partial scan
title: Partial Scan Preserves Cache
description: Keeps cached objects that an incomplete scan could not observe and excludes conflicting duplicate identities from the index.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - resync-index-reconciliation
  commitment:
    features:
      - filesystem-reconciliation
      - vault-file-object-model
---
## Context
Keeps cached objects that an incomplete scan could not observe and excludes conflicting duplicate identities from the index.

## Expected behaviour
A complete scan removes objects whose files disappeared.

## Failure modes
An incomplete scan keeps every object it could not observe and excludes conflicting duplicates.

## Covered by
partial-scan-keeps-unseen-rows, duplicate-ids-excluded-from-index