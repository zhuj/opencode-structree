---
id: unknown-fields-rejected
name: Unknown Fields Are Rejected
title: Unknown Fields Are Rejected
description: Objects are stored exactly as the schema defines them.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - schema-requires-base-fields
  commitsTo:
    - adr-schema-registration-base-contract
    - adr-conservative-compatibility-guards
---
## Rule
Decoding MUST reject unknown object fields and non-JSON-compatible metadata values rather than discarding them, and the persisted object MUST keep every required domain field.
## Evidence
src/lib/registry.ts:234-252; src/lib/registry.ts:130-166; README.md:260
## Why it matters
Silently dropping a field would make the stored object differ from what the caller sent.