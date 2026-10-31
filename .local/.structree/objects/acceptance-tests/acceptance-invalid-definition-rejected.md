---
id: acceptance-invalid-definition-rejected
name: invalid definition acceptance
title: "Acceptance: Invalid Definition Rejected"
description: The scenario invalid-definition-rejected is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - registry-rejects-missing-base-field
    - registry-rejects-conflicting-definitions
---
## Scenario
invalid-definition-rejected - Invalid Definition Rejected
## Criteria covered
registry-rejects-missing-base-field, registry-rejects-conflicting-definitions
## Evidence
test/registry.test.ts