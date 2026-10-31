---
id: sc-vault-invalid-utf8
name: invalid UTF-8 and oversized files are preserved and excluded with issues
title: Invalid Utf8 Excluded With Issues
description: Shows that unreadable or oversized files are excluded from a scan and reported as issues.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-vault-confinement-and-size-violations
  commitsTo:
    - vault-api
---
## Test
invalid UTF-8 and oversized files are preserved and excluded with issues
## File
test/vault.test.ts
## What it proves
Shows that unreadable or oversized files are excluded from a scan and reported as issues.
## Criteria
vault-rejects-oversized-and-invalid-utf8