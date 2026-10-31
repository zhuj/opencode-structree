---
id: resync-keeps-metadata-in-sync
name: resync keeps metadata in sync
title: Keep metadata in sync
description: An unchanged document is counted as unchanged and its metadata row stays byte-identical.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: resync-index-reconciliation
  dependsOn:
    - resync-reports-reconciliation-counts
---
## Statement
Keep metadata in sync: An unchanged document is counted as unchanged and its metadata row stays byte-identical.
## How it is observed
The metadata row for an unchanged document is byte-identical to the row before the pass.