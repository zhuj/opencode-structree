---
id: sc-embedding-missing-key
name: a named but unset environment variable still raises API_KEY_MISSING
title: Missing Api Key Reported
description: Shows that a missing credential fails with the API_KEY_MISSING code.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-embedding-provider-failures
  commitsTo:
    - embedding-provider-interface
---
## Test
a named but unset environment variable still raises API_KEY_MISSING
## File
test/embeddings.test.ts
## What it proves
Shows that a missing credential fails with the API_KEY_MISSING code.
## Criteria
embedding-missing-api-key