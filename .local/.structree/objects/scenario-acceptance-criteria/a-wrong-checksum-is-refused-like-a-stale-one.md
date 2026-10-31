---
id: a-wrong-checksum-is-refused-like-a-stale-one
name: a wrong checksum is refused like a stale one
title: A Wrong Checksum Is Refused Like A Stale One
description: A wrong checksum and a stale checksum both fail with CHECKSUM_CONFLICT, and a missing object fails with NOT_FOUND first.
createdAt: 2026-10-21T08:30:00.000Z
updatedAt: 2026-10-21T08:30:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: agent-tool-surface-sweep
  dependsOn: []
---
## Statement
A wrong checksum and a stale checksum both fail with CHECKSUM_CONFLICT and report the checksum that is actually on disk, and an update of an object that does not exist fails with NOT_FOUND before the checksum is considered.
## How it is observed
The failure details carry `actualChecksum`. An update of an unknown id returns NOT_FOUND even when
the supplied checksum is also wrong.