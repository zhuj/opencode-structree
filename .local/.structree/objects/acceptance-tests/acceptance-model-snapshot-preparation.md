---
id: acceptance-model-snapshot-preparation
name: "Acceptance: Model Snapshot Preparation"
title: "Acceptance: Model Snapshot Preparation"
description: The pinned snapshot is prepared at startup when the configuration permits it, and a failure stays visible.
createdAt: 2026-10-21T04:40:00.000Z
updatedAt: 2026-10-21T04:40:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - model-snapshot-is-fetched-at-startup
    - model-preparation-failure-keeps-fulltext-alive
---
## Scenario
embedding-provider-failures - Embedding Provider Failures
## Criteria covered
model-snapshot-is-fetched-at-startup, model-preparation-failure-keeps-fulltext-alive
## Evidence
test/embeddings.test.ts, test/config.test.ts, test/framework.test.ts