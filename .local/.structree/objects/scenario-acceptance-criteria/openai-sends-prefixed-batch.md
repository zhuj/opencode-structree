---
id: openai-sends-prefixed-batch
name: openai sends prefixed batch
title: Send a prefixed batch
description: The provider posts the prefixed inputs as one JSON batch and reads the response data array by input index.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: openai-embedding-request
  dependsOn: []
---
## Statement
Send a prefixed batch: The provider posts the prefixed inputs as one JSON batch and reads the response data array by input index.
## How it is observed
The captured request body carries the prefixed inputs and the returned vectors follow the response indices.