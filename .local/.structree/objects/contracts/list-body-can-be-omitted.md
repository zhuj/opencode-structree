---
id: list-body-can-be-omitted
name: A List Call Can Omit The Markdown Body
title: A List Call Can Omit The Markdown Body
description: Listing can return identity, title, path and checksum without every body.
createdAt: 2026-10-20T18:48:18.000Z
updatedAt: 2026-10-20T18:48:18.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  commitsTo:
    - adr-advertise-effective-bounds-and-bound-status-output
---
## Rule
The list tools MUST accept includeBody=false and return objects without the body field, and the default MUST keep the body.

## Evidence
`src/lib/mcp.ts` builds the list output from the stored shape with an optional body.

## Why it matters
A caller looking for one identifier paid for every body in the type: the 16 ADRs answered with 47,811 characters before and 12,378 after.