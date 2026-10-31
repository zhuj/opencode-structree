---
id: adr-advertise-effective-bounds-and-bound-status-output
name: Advertise the effective bounds and bound the status output
title: Advertise the Effective Bounds and Bound the Status Output
description: The tool surface advertises the bounds it enforces, the status report bounds its issue list and reports what the bound left out, and the shared workflow is published once in the definitions endpoint.
createdAt: 2026-10-20T18:48:18.000Z
updatedAt: 2026-10-20T18:48:18.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - mcp-crud-tool-round-trip
      - cli-sync-and-status-commands
      - full-text-bm25-ranking
  partOf: null
  dependsOn: []
---
# Advertise the effective bounds and bound the status output

## Context

A language-model ergonomics review of this project's MCP surface, on 2026-10-20, found that
the advertised JSON Schema and the enforced limits disagreed: the schema allowed any integer
for the list limit and the search top-N, while the runtime rejected anything above 1000 and
the configured maximum. The status report repeated its issue list at the top level and inside
the last synchronization report, so a vault with 275 known issues answered a status call with
132,077 characters. An unknown type name produced an error that did not name the valid types,
and nothing in the surface explained the object model or the intended workflow.

## Decision

The list and search input schemas are built per facade, so the advertised bounds are the
effective ones. The status report bounds its issue list, reports the total, whether the list
was truncated and the count per code, and leaves the resync report complete. The registered
type names travel with the unknown-type error and are published as an enum. The workflow
contract is published once in the existing definitions endpoint, and every per-type tool
description points at it. The list tools can omit the Markdown body.

## Consequences

- A caller that reads the schema is no longer rejected by the runtime for a bound the schema
  said was allowed.
- A status call stays small, and the resync report keeps every issue, so nothing is lost.
- The type names are discoverable from the tool list and from the error that needs them.
- The list tools gained an option, so a caller that only needs identity, title, path and
  checksum no longer pays for every body.

## Evidence

- `src/lib/mcp.ts`, `src/lib/framework.ts`, `src/lib/registry.ts`, `src/lib/types.ts`
- `docs/decisions/0007-advertise-effective-bounds-and-bound-status-output.md`
- `docs/llm-ergonomics-proposal.md`
- `test/mcp.test.ts`, `test/framework.test.ts`