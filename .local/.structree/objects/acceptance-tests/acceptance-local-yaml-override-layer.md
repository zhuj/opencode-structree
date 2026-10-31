---
id: acceptance-local-yaml-override-layer
name: yaml override acceptance
title: "Acceptance: Local Yaml Override Layer"
description: The scenario local-yaml-override-layer is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - yaml-override-applies-last
    - yaml-override-parse-failure-reported
---
## Scenario
local-yaml-override-layer - Local Yaml Override Layer
## Criteria covered
yaml-override-applies-last, yaml-override-parse-failure-reported
## Evidence
test/config.test.ts