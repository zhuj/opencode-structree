---
id: cache-refuses-unclaimed-database
name: cache refuses unclaimed database
title: Refuse an unclaimed database
description: Opening a nonempty database with a foreign application_id throws instead of altering its data or schema.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: cache-ownership-and-schema-version
  dependsOn: []
---
## Statement
Refuse an unclaimed database: Opening a nonempty database with a foreign application_id throws instead of altering its data or schema.
## How it is observed
Opening throws and the foreign tables and rows of that file are still present afterwards.