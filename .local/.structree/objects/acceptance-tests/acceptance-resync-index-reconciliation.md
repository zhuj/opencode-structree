---
id: acceptance-resync-index-reconciliation
name: resync acceptance
title: "Acceptance: Resync Index Reconciliation"
description: The scenario resync-index-reconciliation is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - resync-reports-reconciliation-counts
    - resync-keeps-metadata-in-sync
---
## Scenario
resync-index-reconciliation - Resync Index Reconciliation
## Criteria covered
resync-reports-reconciliation-counts, resync-keeps-metadata-in-sync
## Evidence
test/vault-sync.test.ts