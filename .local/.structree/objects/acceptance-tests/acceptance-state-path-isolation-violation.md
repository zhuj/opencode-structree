---
id: acceptance-state-path-isolation-violation
name: path isolation acceptance
title: "Acceptance: State Path Isolation Violation"
description: The scenario state-path-isolation-violation is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - sqlite-cache-outside-root-enforced
    - model-cache-outside-root-enforced
---
## Scenario
state-path-isolation-violation - State Path Isolation Violation
## Criteria covered
sqlite-cache-outside-root-enforced, model-cache-outside-root-enforced
## Evidence
test/config.test.ts