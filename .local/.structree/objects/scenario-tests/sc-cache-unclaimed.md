---
id: sc-cache-unclaimed
name: refuses to claim an unrelated nonempty database without changing its data or schema
title: Unclaimed Database Refused
description: Shows that a nonempty foreign database is refused without mutation.
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
refuses to claim an unrelated nonempty database without changing its data or schema
## File
test/cache-abstraction.test.ts
## What it proves
Shows that a nonempty foreign database is refused without mutation.
## Criteria
cache-refuses-unclaimed-database