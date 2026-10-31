---
id: adr-openai-compatible-embeddings
name: OpenAI compatible embeddings
title: OpenAI Compatible Embeddings
description: Any OpenAI-compatible embedding endpoint can be configured with a literal key, a base URL and a model, with the key kept out of the fingerprint, error messages and every file.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - openai-embedding-request
      - embedding-provider-failures
  partOf: null
  dependsOn: []
---
## Context
This decision is recorded in the project's progress record `.local/.progress/2026-10-20-1504-embeddings-device-and-openai-compatible.md` and in the commit message of `0d1a5d9`. The OpenAI provider only accepted a key through an environment variable, and the user asked on 2026-10-20 to "add support for external openai api compatible provider with apikey, baseurl, model, ....". A literal key is only acceptable in the git-ignored local override file, and network access was out of scope for the work, so no live endpoint, authentication or billing was exercised.

## Decision
The OpenAI-compatible provider accepts a literal `apiKey`, a keyless `apiKeyEnv: ""` that sends no authorization header, a base URL that is rejected when it carries a query or fragment, and a model name, with the literal key taking precedence over the environment variable. The request body sends `dimensions` only to the `text-embedding-3` family, and the key never enters the fingerprint, an error message or any file. The change was implemented and verified on 2026-10-20.

## Consequences
- Any OpenAI-compatible endpoint, including a self-hosted server, can be used without registering an environment variable for its key.
- The secret stays out of the provider fingerprint, so changing the key does not invalidate cached vectors, and it is never written to a file or echoed in an error message.
- A missing environment variable still raises `API_KEY_MISSING`, while an empty variable name deliberately selects a keyless endpoint instead of failing.
- The request body is limited to the model family that accepts an explicit output dimension, and retrieval quality, billing and live authentication remain unexercised.

## Evidence
- `.local/.progress/2026-10-20-1504-embeddings-device-and-openai-compatible.md` (acceptance criteria AC4, AC5 and AC6, and the decisions log)
- commit `0d1a5d9`, "feat: add a project-local OpenCode MCP setup, the .local/.structree layout, and configurable embedding providers"
- `src/lib/embeddings/openai.ts`, `src/lib/embeddings/index.ts` and `test/embeddings.test.ts`