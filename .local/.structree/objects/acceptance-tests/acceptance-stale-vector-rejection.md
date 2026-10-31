---
id: acceptance-stale-vector-rejection
name: stale vectors acceptance
title: "Acceptance: Stale Vector Rejection"
description: The scenario stale-vector-rejection is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - stale-vector-publication-rejected
    - chunk-zero-must-match-whole-file
---
## Scenario
stale-vector-rejection - Stale Vector Rejection
## Criteria covered
stale-vector-publication-rejected, chunk-zero-must-match-whole-file
## Evidence
test/sqlite.test.ts