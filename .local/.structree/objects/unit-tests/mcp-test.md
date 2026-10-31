---
id: mcp-test
name: mcp.test.ts
title: Mcp Test
description: Covers the generated MCP tool surface, protocol round trips, strict output validation and repair notices.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-21T08:32:00.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn: []
  relatesTo:
    - sc-mcp-tool-count
    - sc-mcp-crud-round-trip
    - sc-mcp-stale-checksum
    - sc-mcp-repair-accept
    - sc-mcp-repair-notices
    - sc-repair-budget
    - sc-identifier-and-surface-restrictions
    - sc-agent-tool-surface-sweep
    - sc-tool-surface-failure-codes
  commitsTo:
    - interface
    - object-definition
    - configuration-layer
---
## File
test/mcp.test.ts
## What it covers
attaches the generated tools to an existing host server without replacing its tools | advertises all 64 tools with schema-derived required fields and optional wrapper keys | round-trips CRUD through real protocol serialization with Date conversion and revision errors | rejects omitted nullable fields; malformed dates; extras; and null optional wrapper keys before mutations | repairs mixed nested relation fields and key casing while preserving arbitrary records and body | infers omitted object wrappers and parses stringified nested JSON before strict decoding | repairs search scalar types and scalar array wrappers without rewriting query text | rejects conflicting repairs; unsupported field guesses; and invalid checksum types without mutation | keeps output validation strict when arguments were repaired | rejects empty identifiers for get, delete, and update arguments | inherits strict mode from framework configuration and supports explicit host overrides | rejects malformed host repair options instead of silently enabling defaults | enforces configured input budgets before calling handlers; including strict mode | keeps repair notices with their own responses during overlapping calls | forwards shared search options unchanged; emits status/resync; and leaves facade ownership with caller | propagates client request cancellation into the facade AbortSignal | the Effect Standard Schema bridge matches strict JSON metadata for both supported dialects | advertises the exact query; type; mode; search and status descriptions that state the real query semantics and the provider requirement | the advertised schema accepts the optional excerpt as a string; null or absent and rejects any other type | the exact excerpt disclosure is part of the advertised tool description | the advertised mode description states that the local provider fetches its snapshot at startup
## Verifies
mcp-crud-tool-round-trip, mcp-tool-error-contract, mcp-input-repair-accepted, mcp-input-repair-refused, full-text-query-semantics, fulltext-excerpt, model-snapshot-prepared-at-startup, identifier-and-surface-restrictions
## Exercises
interface, object-definition, configuration-layer