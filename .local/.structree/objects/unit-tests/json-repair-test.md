---
id: json-repair-test
name: json-repair.test.ts
title: Json Repair Test
description: Checks the end-to-end repair pipeline for wrappers; misrouted fields; type coercion and strict refusals.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo: []
  commitsTo:
    - interface
    - configuration-layer
---
## File
test/json-repair.test.ts
## What it covers
valid values use the original codec without rewriting maps or strings | recovers full object and relationship wrappers with all required fields supplied | moves misplaced fields out of a relation container without copying existing values | parses relaxed text; applies key repair; and then rejects schema refinements | refuses a fractional numeric spelling instead of rounding it onto an integer | an integer literal refuses a fractional spelling that rounds onto it | leaves encoded transforms to Effect rather than coercing their domain type | awaits asynchronous Effect decoding before returning a repaired domain value | never invents missing required nullable values; arrays; or dates | array splitting is opt-in; keeps empty members; and has a bounded allocation | recovers only one unambiguous enum representation and preserves ordinary string values
## Verifies
mcp-input-repair-accepted, mcp-input-repair-refused
## Exercises
interface, configuration-layer