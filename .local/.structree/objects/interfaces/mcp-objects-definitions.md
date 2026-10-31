---
id: mcp-objects-definitions
name: MCP Objects Definitions
title: MCP Objects Definitions
description: Lists the registered object types and canonical JSON schemas generated from their Effect definitions, optionally filtered to one type, together with the shared workflow contract.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  partOf: null
  dependsOn:
    - object-registry
  usedBy:
    - schema-requires-base-fields
    - unknown-fields-rejected
  commitsTo:
    - adr-project-local-mcp-registration
    - adr-schema-registration-base-contract
---
## Surface
src/lib/mcp.ts (objects_definitions)

## Behavior
Derives each schema from the Effect definition so required keys and descriptions match the tool inputs. An optional type returns one registered type; omitting it returns every type. The response also carries the shared workflow contract.

## Guarantees
- An unknown type fails with UNKNOWN_TYPE and the registered names in its details.
- The guidance array states the id rule, the checksum discipline, the timestamp ownership, the unvalidated relations and the limits of search.
- The advertised schemas match the per-type tool inputs exactly.