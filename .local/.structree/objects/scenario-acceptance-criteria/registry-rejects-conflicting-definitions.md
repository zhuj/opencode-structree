---
id: registry-rejects-conflicting-definitions
name: registry rejects conflicting definitions
title: Reject conflicting definitions
description: A duplicate type name or an overlapping object directory throws INVALID_DEFINITION.
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
Reject conflicting definitions: A duplicate type name or an overlapping object directory throws INVALID_DEFINITION.
## How it is observed
register throws a FrameworkError with code INVALID_DEFINITION and the registry size is unchanged.