---
id: acceptance-registry-registration-validation
name: registry validation acceptance
title: "Acceptance: Registry Registration Validation"
description: The scenario registry-registration-validation is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - registry-accepts-complete-base-schema
    - registry-round-trips-decode-and-encode
---
## Scenario
registry-registration-validation - Registry Registration Validation
## Criteria covered
registry-accepts-complete-base-schema, registry-round-trips-decode-and-encode
## Evidence
test/registry.test.ts