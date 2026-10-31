---
id: json-repair-schema-test
name: json-repair-schema.test.ts
title: Json Repair Schema Test
description: Covers the JSON Schema to repair-shape adapter, recursive references and fuzzy key distance rules.
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
    - object-definition
    - interface
---
## File
test/json-repair-schema.test.ts
## What it covers
preserves required nullable fields and leaves tag and metadata maps opaque | derives every registered entity from the same canonical wire schema | distinguishes optional fields from nullable fields and ignores annotation defaults | uses encoded scalar types and retains literal and union alternatives | keeps arbitrary maps and unsupported compositions opaque | resolves recursive Effect refs without expanding infinitely or omitting child fields | resolves escaped local pointers and leaves missing; inherited; external and cyclic refs opaque | caps unusually deep schema traversal and does not expose object prototype properties | prefers canonical spelling and supports conventional case and word separators | reports every best candidate independently of declaration order | accepts strong edit matches while rejecting weak prefixes and short identifier guesses | calculates insertion; deletion; substitution and transposition distances without greedy exits
## Verifies
mcp-input-repair-accepted
## Exercises
object-definition, interface