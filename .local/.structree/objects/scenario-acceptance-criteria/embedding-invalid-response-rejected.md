---
id: embedding-invalid-response-rejected
name: embedding invalid response rejected
title: Reject an invalid provider response
description: A response with a wrong vector count or a duplicate input index fails with code INVALID_RESPONSE.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: embedding-provider-failures
  dependsOn: []
---
## Statement
Reject an invalid provider response: A response with a wrong vector count or a duplicate input index fails with code INVALID_RESPONSE.
## How it is observed
The call rejects with code INVALID_RESPONSE and no vector is returned.