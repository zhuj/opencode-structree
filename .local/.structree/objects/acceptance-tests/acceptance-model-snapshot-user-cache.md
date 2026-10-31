---
id: acceptance-model-snapshot-user-cache
name: model snapshot user cache acceptance
title: "Acceptance: Model Snapshot User Cache"
description: The criterion model-snapshots-are-shared-through-the-user-cache holds.
createdAt: 2026-10-21T10:40:00.000Z
updatedAt: 2026-10-21T10:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - model-snapshots-are-shared-through-the-user-cache
---
## Scenario
embedding-provider-failures - Embedding Provider Failures
## Criteria covered
model-snapshots-are-shared-through-the-user-cache
## Evidence
test/config.test.ts, test/embeddings.test.ts, docs/decisions/0014-keep-model-snapshots-in-the-user-cache.md