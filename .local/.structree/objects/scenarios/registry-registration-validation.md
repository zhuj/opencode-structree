---
id: registry-registration-validation
name: registry validation
title: Registry Registration Validation
description: Registers a definition whose schema provides every base field and round-trips decode and encode of its objects.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  project: structree-initial
  partOf: null
  dependsOn: []
  commitment:
    features:
      - object-registry-and-schemas
---
## Context
Registers a definition whose schema provides every base field and round-trips decode and encode of its objects.

## Expected behaviour
A definition with the full base contract registers and its objects decode and encode canonically.

## Failure modes
A decoded object that violates the base contract or carries a non-finite number is rejected.

## Covered by
registry-accepts-complete-base-schema, registry-round-trips-decode-and-encode