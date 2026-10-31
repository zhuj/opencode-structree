---
id: acceptance-load-json-configuration
name: json config acceptance
title: "Acceptance: Load Json Configuration"
description: The scenario load-json-configuration is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - json-config-provider-defaults-merged
    - json-config-paths-resolved
    - json-config-invalid-values-rejected
---
## Scenario
load-json-configuration - Load Json Configuration
## Criteria covered
json-config-provider-defaults-merged, json-config-paths-resolved, json-config-invalid-values-rejected
## Evidence
test/config.test.ts