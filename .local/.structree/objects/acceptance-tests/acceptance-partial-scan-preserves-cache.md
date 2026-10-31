---
id: acceptance-partial-scan-preserves-cache
name: partial scan acceptance
title: "Acceptance: Partial Scan Preserves Cache"
description: The scenario partial-scan-preserves-cache is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - partial-scan-keeps-unseen-rows
    - duplicate-ids-excluded-from-index
---
## Scenario
partial-scan-preserves-cache - Partial Scan Preserves Cache
## Criteria covered
partial-scan-keeps-unseen-rows, duplicate-ids-excluded-from-index
## Evidence
test/framework.test.ts, test/vault-sync.test.ts