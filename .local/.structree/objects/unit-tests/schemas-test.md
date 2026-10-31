---
id: schemas-test
name: schemas.test.ts
title: Schemas Test
description: Validates the shipped Effect schemas for entities, relationships, JSON round trips and generated JSON Schema.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T07:10:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-identifier-and-surface-restrictions
  commitsTo:
    - object-definition
    - project
    - feature
---
## File
test/schemas.test.ts
## What it covers
contain the exact concrete entities and each required relationship | reject empty identifiers without validating relation targets or relationship integrity | nullable fields accept explicit null; and timestamps are domain Dates | round-trips every entity through canonical JSON without losing Date types | rejects metadata that JSON serialization would silently alter or omit | generates required fields; strict object shapes; and truthful relationship descriptions | registers custom Effect definitions and refuses ambiguous names or directories
## Verifies
registry-registration-validation, invalid-definition-rejected, identifier-and-surface-restrictions
## Exercises
object-definition, project, feature