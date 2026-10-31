---
id: json-syntax-test
name: json-syntax.test.ts
title: Json Syntax Test
description: Validates the relaxed JSON text parser, its repairs and its structural safety limits.
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
---
## File
test/json-syntax.test.ts
## What it covers
valid JSON preserves the original text; scalar values; and nested structure | repairs unquoted keys; single quotes; and trailing commas while preserving punctuation | accepts a complete markdown fence and comments | infers missing root object braces and closing containers for complete values | quoted brackets do not consume the structural depth budget during repair | preserves complete escaped strings and raw newlines without removing backslashes | rejects unterminated strings; invalid escapes; and incomplete numeric values | rejects repairs that would invent nulls or discard supplied values | rejects duplicate object keys before valid JSON loses the first value | rejects duplicate keys after syntax repair; including escaped single-quoted keys | rejects unsafe property names at every depth; including escaped names | applies UTF-8 byte limits before any repair or parsing | counts values as nodes; excluding keys; and enforces depth without recursion | rejects deeply malformed structures before jsonrepair can recurse | rejects empty input; mismatched brackets; and invalid limits with a named error
## Verifies
mcp-input-repair-accepted, mcp-input-repair-refused
## Exercises
interface