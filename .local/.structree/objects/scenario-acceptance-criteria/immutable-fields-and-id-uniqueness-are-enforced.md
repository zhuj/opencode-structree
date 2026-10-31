---
id: immutable-fields-and-id-uniqueness-are-enforced
name: immutable fields and id uniqueness are enforced
title: Immutable Fields And Id Uniqueness Are Enforced
description: A changed id or createdAt is refused, a taken id is refused, and the same id in another type is accepted.
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
An update that changes `id` fails with IMMUTABLE_ID and one that changes `createdAt` fails with IMMUTABLE_CREATED_AT. A second create of an existing id in the same type fails with ALREADY_EXISTS, and the same id in another type is accepted, because an id is unique within its type.
## How it is observed
Each failure names the field or the id it refused. The cross-type create returns the stored object
with its own path and checksum.