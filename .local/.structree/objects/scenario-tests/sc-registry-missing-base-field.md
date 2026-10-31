---
id: sc-registry-missing-base-field
name: a schema that omits a required base field is rejected at registration
title: Missing Base Field Rejected
description: Shows that a definition lacking a required base field is refused at registration.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-invalid-definition-rejected
  commitsTo:
    - object-registry
---
## Test
a schema that omits a required base field is rejected at registration
## File
test/registry.test.ts
## What it proves
Shows that a definition lacking a required base field is refused at registration.
## Criteria
registry-rejects-missing-base-field