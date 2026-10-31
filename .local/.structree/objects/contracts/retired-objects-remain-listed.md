---
id: retired-objects-remain-listed
name: Retired Objects Remain Listed
title: Retired Objects Remain Listed
description: A retired object stays in the listing of its type and in search results, and the published surface says so.
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

`retiredAt` marks an object. It does not remove it.

A retired object MUST remain in the listing of its type and MUST remain a candidate for search. The
published field description and the per-type list description MUST state this, and a caller excludes
a retired object by checking the field.

## Why

Hiding a retired object would make its retirement undiscoverable, because discovery already goes
through the listing and the search index. The field is the record of retirement, so the field and the
listing must agree.

## Evidence

test/mcp.test.ts, and the live surface on 2026-10-21