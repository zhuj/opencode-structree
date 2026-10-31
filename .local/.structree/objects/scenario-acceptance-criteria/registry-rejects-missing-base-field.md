---
id: registry-rejects-missing-base-field
name: registry rejects missing base field
title: Reject a missing base field
description: Registering a schema that omits a required base field throws INVALID_DEFINITION naming the missing field.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: invalid-definition-rejected
  dependsOn: []
---
## Statement
Reject a missing base field: Registering a schema that omits a required base field throws INVALID_DEFINITION naming the missing field.
## How it is observed
register throws a FrameworkError with code INVALID_DEFINITION whose message names the missing field.