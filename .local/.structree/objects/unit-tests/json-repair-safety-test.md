---
id: json-repair-safety-test
name: json-repair-safety.test.ts
title: Json Repair Safety Test
description: Proves the input safety limits reject hostile JSON values before any repair runs.
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
test/json-repair-safety.test.ts
## What it covers
accepts exact serialized UTF-8 byte limits for objects and arrays | already valid objects obey the same container depth limit as JSON text | stringified containers cannot add empty objects beyond the global depth limit | stringified sibling containers share the final node limit | valid and strict-mode inputs cannot skip node or byte checks | top-level syntax and schema repairs share one cumulative repair limit | cycles fail while repeated noncyclic references count as repeated JSON data | rejects accessors and serialization hooks without invoking them | rejects proxies before invoking reflection traps | revoked proxies become structured failures instead of thrown reflection errors | rejects non-JSON prototypes; hidden properties; symbols; and unusual arrays | unsafe names remain invalid inside opaque metadata and stringified structures
## Verifies
mcp-input-repair-refused
## Exercises
interface, configuration-layer