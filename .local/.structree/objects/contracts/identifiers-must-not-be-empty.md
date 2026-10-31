---
id: identifiers-must-not-be-empty
name: Identifiers Must Not Be Empty
title: Identifiers Must Not Be Empty
description: An identifier is never the empty string, while a non-empty identifier naming a target that does not exist is still stored as written.
createdAt: 2026-10-21T07:05:00.000Z
updatedAt: 2026-10-21T07:05:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-publish-observed-surface-and-reject-empty-identifiers
---
## Rule

An identifier MUST NOT be the empty string.

The object id, a required owner identifier such as `relations.project`, and every identifier inside a
relation array MUST be rejected as invalid input when they are empty. The published JSON Schema MUST
expose `minLength: 1` for those fields, and the published argument descriptions MUST state the rule.

An identifier that is not empty MUST still be accepted when it names a target that does not exist.
Relation targets are not validated for existence, and no write is rejected on that account.

## Why

An empty owner identifier is a link to nothing that reads like a link, and the vault cannot tell it
apart from a mistyped id. An empty object id also collides with the file name, which is a hash of
the id.

## Evidence

test/schemas.test.ts, test/mcp.test.ts