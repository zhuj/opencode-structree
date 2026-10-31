---
id: openai-retries-transient-status
name: openai retries transient status
title: Retry a transient failure
description: A 429 or 5xx response is retried up to the configured retries and then reported as HTTP_ERROR.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: openai-embedding-request
  dependsOn:
    - openai-sends-prefixed-batch
---
## Statement
Retry a transient failure: A 429 or 5xx response is retried up to the configured retries and then reported as HTTP_ERROR.
## How it is observed
The mock endpoint is called the configured number of times and the final error code is HTTP_ERROR.