---
id: invalid-definition-rejected
name: invalid definition
title: Invalid Definition Rejected
description: Rejects a definition with a missing base field, a duplicate name or an overlapping directory.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn:
    - registry-registration-validation
  commitment:
    features:
      - object-registry-and-schemas
---
## Context
Rejects a definition with a missing base field, a duplicate name or an overlapping directory.

## Expected behaviour
A complete, uniquely named definition with a non-overlapping directory registers.

## Failure modes
Missing base fields, duplicate names and overlapping directories are rejected at registration.

## Covered by
registry-rejects-missing-base-field, registry-rejects-conflicting-definitions