---
id: sc-tool-surface-failure-codes
name: names the code for every failure an agent can meet
title: Names The Code For Every Failure
description: Shows that a stale or wrong checksum, a changed immutable field, a taken id, a missing object and a repeated delete each fail with their own code.
createdAt: 2026-10-21T08:30:00.000Z
updatedAt: 2026-10-21T08:30:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - acceptance-agent-tool-surface-sweep
  commitsTo:
    - mcp-object-crud-tools
    - object-facade
---
## Test
names the code for every failure an agent can meet
## File
test/framework.test.ts, test/mcp.test.ts, test/sqlite.test.ts
## What it proves
The failure codes are the ones an agent can act on: CHECKSUM_CONFLICT with the actual checksum, NOT_FOUND for a missing object, IMMUTABLE_ID, IMMUTABLE_CREATED_AT, ALREADY_EXISTS for a taken id in the same type, and VALIDATION for an argument the schema refuses.
## Criteria
a-wrong-checksum-is-refused-like-a-stale-one, immutable-fields-and-id-uniqueness-are-enforced, deletion-is-complete-and-not-repeatable