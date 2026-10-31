---
id: embedding-missing-api-key
name: embedding missing api key
title: Refuse a request without credentials
description: A named but unset API key environment variable fails with code API_KEY_MISSING before any HTTP request is sent.
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
Refuse a request without credentials: A named but unset API key environment variable fails with code API_KEY_MISSING before any HTTP request is sent.
## How it is observed
The call rejects with code API_KEY_MISSING and the injected fetch records no request.