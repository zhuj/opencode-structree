---
id: workflow-contract-published-once
name: The Shared Workflow Is Published Once
title: The Shared Workflow Is Published Once
description: The workflow every type shares is stated in one place and pointed at from the tools.
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
objects_definitions MUST publish the shared workflow contract, and every per-type tool description MUST point at it rather than restating it.

## Evidence
`src/lib/mcp.ts` returns the guidance array with the definitions and appends one clause to each per-type description.

## Why it matters
Restating the contract in sixty descriptions would multiply its cost in the tool list without adding anything.