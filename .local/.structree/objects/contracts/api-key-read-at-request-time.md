---
id: api-key-read-at-request-time
name: API Key Is Read At Request Time
title: API Key Is Read At Request Time
description: The credential is resolved from the environment when the request is made.
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
The OpenAI provider MUST read the configured environment variable at request time, MUST send no Authorization header when apiKeyEnv is empty, and MUST fail with API_KEY_MISSING before any HTTP request when a named variable is unset.
## Evidence
src/lib/embeddings/openai.ts:75-81; src/lib/embeddings/openai.ts:115-121
## Why it matters
A rotated key takes effect without restarting the process, and a missing key costs no request.