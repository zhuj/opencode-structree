---
id: acceptance-serialized-cross-process-writes
name: lock serialize acceptance
title: "Acceptance: Serialized Cross Process Writes"
description: The scenario serialized-cross-process-writes is accepted when all of its criteria hold.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - lock-serializes-two-instances
    - lock-releases-after-callback-failure
---
## Scenario
serialized-cross-process-writes - Serialized Cross Process Writes
## Criteria covered
lock-serializes-two-instances, lock-releases-after-callback-failure
## Evidence
test/framework.test.ts, test/process-lock.test.ts