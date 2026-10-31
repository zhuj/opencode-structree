---
id: embedding-base-url-sanitized
name: Embedding Base URL Is Sanitized
title: Embedding Base URL Is Sanitized
description: The embedding endpoint cannot smuggle a credential.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-openai-compatible-embeddings
    - adr-redacted-client-diagnostics
---
## Rule
baseUrl MUST be an HTTP or HTTPS URL and MUST NOT contain embedded credentials, a query string or a fragment, in configuration and in the provider.
## Evidence
src/lib/config.ts:269-283; src/lib/embeddings/openai.ts:58-70
## Why it matters
A query string or userinfo field could carry a key into an endpoint fingerprint or a log.