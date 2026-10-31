---
id: api-key-not-in-fingerprint
name: API Key Never Enters The Fingerprint
title: API Key Never Enters The Fingerprint
description: An embedding credential never influences the cache identity and never leaks.
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
---
## Rule
An API key MUST NOT be written to the embedding fingerprint, MUST NOT appear in an error message, and MUST NOT be written to any file.
## Evidence
src/lib/embeddings/openai.ts:73-90; docs/embeddings.md:39; test/embeddings.test.ts:250-267
## Why it matters
A fingerprint can be reported to a client, so it must never carry a credential.