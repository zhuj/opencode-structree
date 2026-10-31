---
id: incomplete-scan-no-deletion
name: Incomplete Scan Must Not Delete
title: Incomplete Scan Must Not Delete
description: A scan that could not read everything must not be treated as proof of absence.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-filesystem-commit-and-reconciliation
---
## Rule
Reconciliation MUST NOT remove index rows for objects that an incomplete scan did not observe, and MUST NOT report those objects as deleted.
## Evidence
src/lib/vault/reconciliation.ts:51-52; README.md:330
## Why it matters
A single unreadable directory would otherwise delete the whole index.