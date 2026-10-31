---
id: confirmed-conflict-invalidates
name: Confirmed Conflict Invalidates
title: Confirmed Conflict Invalidates
description: A positively confirmed identity conflict is evidence of invalidity even when the scan is incomplete.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - duplicate-identity-excluded
    - incomplete-scan-no-deletion
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
Reconciliation MUST invalidate the index rows of every confirmed conflicting key, even when the overall scan is incomplete.
## Evidence
src/lib/vault/reconciliation.ts:53-56; src/lib/framework.ts:336-337
## Why it matters
A conflict is a proven defect, unlike an object that was simply not observed.