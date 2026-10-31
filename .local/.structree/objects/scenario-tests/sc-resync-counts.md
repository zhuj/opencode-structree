---
id: sc-resync-counts
name: partial scans update valid entries while preserving unknown cached identities
title: Resync Updates Valid Entries
description: Shows that a partial scan updates valid entries and keeps unknown cached identities.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-resync-index-reconciliation
  commitsTo:
    - object-facade
    - sqlite-index-api
---
## Test
partial scans update valid entries while preserving unknown cached identities
## File
test/vault-sync.test.ts
## What it proves
Shows that a partial scan updates valid entries and keeps unknown cached identities.
## Criteria
resync-reports-reconciliation-counts, resync-keeps-metadata-in-sync