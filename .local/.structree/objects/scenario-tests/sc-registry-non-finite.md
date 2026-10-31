---
id: sc-registry-non-finite
name: a non-finite decoded number is rejected with the offending field path
title: Non Finite Number Rejected
description: Shows that a decoded non-finite number is refused with its field path.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-registry-registration-validation
  commitsTo:
    - object-registry
---
## Test
a non-finite decoded number is rejected with the offending field path
## File
test/registry.test.ts
## What it proves
Shows that a decoded non-finite number is refused with its field path.
## Criteria
registry-round-trips-decode-and-encode