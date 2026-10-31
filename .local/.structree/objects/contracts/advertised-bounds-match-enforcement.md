---
id: advertised-bounds-match-enforcement
name: Advertised Bounds Match Enforcement
title: Advertised Bounds Match Enforcement
description: The advertised tool schema states the limits the server enforces.
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
The tool input schemas MUST advertise the same limits the server enforces, and a value outside an advertised bound MUST be rejected by input validation.

## Evidence
`src/lib/mcp.ts` builds the list and search schemas per facade; `src/lib/framework.ts` enforces the same constants.

## Why it matters
A caller that reads the schema and is then rejected for a value the schema allowed has no way to learn the real limit.