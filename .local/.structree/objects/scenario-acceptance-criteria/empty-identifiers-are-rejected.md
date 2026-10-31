---
id: empty-identifiers-are-rejected
name: empty identifiers are rejected
title: Empty Identifiers Are Rejected
description: An empty object id, an empty owner identifier and an empty identifier inside a relation array are refused as invalid input.
createdAt: 2026-10-21T07:05:00.000Z
updatedAt: 2026-10-21T07:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  scenario: identifier-and-surface-restrictions
  dependsOn: []
---
## Statement
Empty identifiers are rejected: an empty object id, an empty owner identifier and an empty identifier inside a relation array are refused as invalid input, and the published JSON Schema exposes `minLength: 1` for them.
## How it is observed
A create with an empty id fails with an input validation error naming `object.id`; a create with an empty `relations.project` fails naming `object.relations.project`; a get with an empty id fails naming `id`. A create with a non-empty identifier that names a target which does not exist still succeeds.