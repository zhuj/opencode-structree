---
id: sc-cache-version
name: refuses a cache from an unsupported version without dropping fields
title: Unsupported Cache Version Refused
description: Shows that a cache with an unsupported schema version is refused without losing fields.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-cache-ownership-and-schema-version
  commitsTo:
    - sqlite-table-api
---
## Test
refuses a cache from an unsupported version without dropping fields
## File
test/cache-abstraction.test.ts
## What it proves
Shows that a cache with an unsupported schema version is refused without losing fields.
## Criteria
cache-refuses-unsupported-schema-version