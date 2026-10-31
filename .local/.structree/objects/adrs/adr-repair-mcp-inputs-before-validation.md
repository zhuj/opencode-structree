---
id: adr-repair-mcp-inputs-before-validation
name: Repair MCP inputs before validation
title: Repair MCP Inputs Before Validation
description: The generated MCP tool input boundary performs schema-guided repair inside the input validator and then requires the original strict Effect codec to validate every repaired candidate before the facade receives it.
createdAt: 2026-10-20T17:40:26.000Z
updatedAt: 2026-10-20T17:40:26.000Z
retiredAt: null
tags: {}
metadata: {}
relations:
  commitment:
    scenarios:
      - mcp-input-repair-accepted
      - mcp-input-repair-refused
  partOf: null
  dependsOn: []
---
## Context
The framework exposes 64 generated tools with nested, required object fields, and model-generated arguments can flatten a nested path such as `object.relations.commitment.features`, omit an object wrapper, change key casing or supply a JSON container as a string. Rejecting every such representation forces callers to repeat an entire mutation even when the schema determines one intended destination, and the supplied relaxed parser's independent Zod schemas and lossy fallbacks conflict with required Effect fields, opaque metadata and complete object replacement. The request to adopt relaxed parsing was made by the user on 2026-10-19.

## Decision
The MCP input boundary performs schema-guided repair inside the generated tool's input validator, derives repair hints from the original Effect codec's canonical encoded JSON Schema, and requires that strict codec to validate every repaired candidate before the facade receives it. Repair is enabled by default under `mcp.inputRepair`, can be disabled per framework or host registration, and successful repairs are reported under the response's `_meta["object-mcp/input-repair"]`. The adoption was requested by the user on 2026-10-19 and is recorded as accepted.

## Consequences
- All generated tools share one repair policy while keeping typed Effect outputs, and a structural repair is observable, rejects collisions independently of input order, and cannot bypass facade checksum or immutable-field checks.
- Matching confidence is a deterministic heuristic rather than a calibrated probability of model intent, so some repairable requests deliberately fail when the canonical destination is ambiguous or the schema construct is opaque.
- Repair adds maintenance obligations to the input boundary, including resource guards and adversarial regression tests, and reserved-key rejection is stricter than the domain's arbitrary map schema.
- The outer SDK transport still requires valid JSON-RPC, so malformed envelopes and duplicate properties already collapsed by the transport decoder cannot be recovered.

## Evidence
- `docs/decisions/0005-repair-mcp-inputs-before-effect-validation.md` (status accepted, decision-maker "User", dated 2026-10-19)
- `src/lib/mcp-input.ts`, `src/lib/json-repair/pipeline.ts`, `src/lib/json-repair/name-mapper.ts` and `src/lib/json-repair/syntax.ts`
- `docs/relaxed-json.md` and `test/mcp-repair-filesystem.test.ts`