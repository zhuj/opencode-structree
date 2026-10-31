---
id: cache-key-joins-type-and-id
name: cache key joins type and id
title: Cache Key Joins Type And Id
description: The cache key is the type and the id joined by a colon, and the framework never decodes it.
createdAt: 2026-10-21T09:05:00.000Z
updatedAt: 2026-10-21T09:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: cache-object-identity
  dependsOn: []
---
## Statement
The cache key is the type and the id joined by a colon, for example "project:structree-initial". A type containing a colon is refused rather than given an ambiguous identity.
## How it is observed
The key of a plain object reads as the type, a colon and the id. The row carries the type in its type column and the exact id in its canonical JSON column, and no code parses the key.