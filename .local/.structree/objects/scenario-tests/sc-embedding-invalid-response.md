---
id: sc-embedding-invalid-response
name: permanent HTTP errors and malformed indices are not retried
title: Malformed Response Not Retried
description: Shows that a malformed provider response fails immediately with an invalid-response error.
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
permanent HTTP errors and malformed indices are not retried
## File
test/embeddings.test.ts
## What it proves
Shows that a malformed provider response fails immediately with an invalid-response error.
## Criteria
embedding-invalid-response-rejected