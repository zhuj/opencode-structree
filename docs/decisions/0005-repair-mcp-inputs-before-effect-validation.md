---
status: accepted
date: "2026-10-19"
decision-makers: ["User"]
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0005. Repair MCP argument structure before final Effect validation

## Decision summary

Adopt the supplied relaxed JSON parser's syntax repair, key matching, structural
mapping, wrapper inference, and repair-report concepts at the generated MCP tool
input boundary. Derive repair hints from the original Effect codec's encoded
JSON Schema and require that codec to validate every repaired candidate before
calling the facade.

This records the user's explicit request on 2026-10-19 to adopt relaxed parsing
so a model can recover from mixed fields in complex structures. The conservative
matching rules and configurable bounds are implementation choices supporting
that direction; no separate stakeholder performance target was supplied.

## Context and problem statement

The framework exposes 64 generated tools with nested, required object fields.
For example, scenario commitments belong at
`object.relations.commitment.features`. Model-generated arguments can flatten
that path, omit an object wrapper, change key casing, or supply a JSON container
as a string. Rejecting every such representation forces callers to repeat the
entire mutation, even when the schema determines one intended destination.

The supplied parser inspects Zod, returns repaired values without final schema
validation, skips some unknown fields, and chooses some matches by input or
schema order. Its fallback can overwrite duplicate properties and its coercion
can strip characters or round numbers. Those behaviors conflict with required
Effect fields, opaque metadata, complete object replacement, and source revision
guards in this framework.

The installed MCP server 2.3.1 passes transformed Standard Schema input to the
tool executor. Tool-list JSON schemas are exposed separately. This gives the
framework a repair boundary without changing domain schemas or replacing the
SDK transport. Filesystem reconciliation, database codecs, and tool output
validation are outside this decision's repair scope.

## Decision drivers

- Fulfill the requested recovery from mixed fields in complex MCP arguments.
- Keep Effect as the application's schema system and authority for constraints,
  encoded dates, transforms, required keys, and custom object definitions.
- Preserve supplied information and reject conflicting destinations.
- Keep IDs, checksums, Markdown bodies, and arbitrary map data faithful to their
  supplied values; preserve existing filesystem mutation guards.
- Report applied changes per request without mixing concurrent clients' data.
- Bound parsing work and provide a strict mode for hosts that prefer retries.

## Considered options

1. **Advertise canonical inputs and require client-side retries.** This keeps
   the server's boundary small and makes callers responsible for correcting
   model output. It remains available through strict mode, but does not provide
   the requested server-side recovery and can repeat large object payloads.
2. **Adapt schema-guided repair inside the MCP input validator**, selected.
   The server can correct uniquely identifiable structures for every generated
   tool. It requires maintained matching rules, explicit ambiguity handling,
   resource limits, and test evidence that rejected repairs cannot mutate data.

The supplied implementation cannot be adopted verbatim because its independent
Zod schemas and lossy fallbacks would violate the existing object contract.
Permissively reparsing whole JSON-RPC transport messages is not required to solve
argument layout mistakes and would expand the protocol failure surface.

## Decision outcome

The input adapter first inspects plain JSON data for bounded size, depth, node
count, unsafe property names, and non-JSON objects. Valid canonical arguments go
directly through the existing Effect codec. On validation failure, the configured
repairer prepares a candidate; the original strict codec then validates that
candidate before the facade receives it.

Repair hints come from Effect's canonical encoded JSON Schema, including local
references. Unknown constructs remain opaque. Repairs use exact and conventional
spelling matches before bounded edit distance. A canonical field in an enclosing
structure takes precedence over a local typo guess. Shared leaf names, equal
duplicate destinations, conflicting parent values, and divergent union repairs
are errors. Every member of a flattened wrapper must have a unique destination.

Syntax repair uses pinned `jsonrepair` 3.15.0 behind an iterative scanner. The
scanner detects duplicate keys before `JSON.parse` can collapse them. An ordered
token check prevents syntax repair from inserting, dropping, or merging supplied
scalar values. Unterminated strings, incomplete numbers, missing values,
ellipses, and function expressions fail. Nested stringified containers count
toward the final global resource limits.

Schema-guided coercion accepts complete finite numeric strings, exact boolean
words, unambiguous literal formatting, and explicit container construction.
It does not stringify IDs or objects, round integers, invent required arrays or
nulls, or fill absent domain fields. Delimiter splitting is opt-in because a
delimiter may belong to an identifier. Record/Any contents are opaque to repair;
the adopted reserved-key check still rejects `__proto__`, `constructor`, and
`prototype` throughout input data.

Repair is enabled by default under `mcp.inputRepair` and can be configured or
disabled per framework or host registration. JSON schemas advertised to clients
remain canonical, and outputs retain strict validation. Successful repairs are
reported under the matching response's `_meta["object-mcp/input-repair"]` using
a registration-local weak map keyed by decoded argument identity.

## Consequences

### Positive

- All generated tools share one repair policy and retain typed Effect outputs.
- Valid input follows the existing decoding path, preserving arbitrary map
  values and avoiding unnecessary inference.
- Structural repair is observable, rejects collisions independently of input
  order, and cannot bypass facade checksum or immutable-field checks.
- The public asynchronous `parseJson` API also validates its result with Effect;
  low-level candidate APIs explicitly require a subsequent codec validation.

### Negative

- Repair adds code and maintenance obligations to an input boundary. Resource
  guards and adversarial regression tests are part of that ongoing obligation.
- Matching confidence is a deterministic heuristic, not a calibrated probability
  of a model's intent. Some repairable requests deliberately fail when the
  canonical destination is ambiguous or the schema construct is opaque.
- Repair reports require clients to inspect response metadata; not every client
  displays it automatically.
- Reserved-key rejection is stricter than the domain's arbitrary map schema.
  Hosts cannot use those property names in MCP arguments, even in strict mode.
- The outer SDK transport still requires valid JSON-RPC. Malformed envelopes and
  duplicate properties already collapsed by the transport decoder cannot be
  recovered or retrospectively detected by an argument validator.

Strict mode is the exit path if a host's model, custom schemas, or operational
requirements make server-side inference undesirable. Further recovery strategies
should be added only with examples proving their information-preservation and
ambiguity behavior.

## Confirmation

The MCP suite verifies actual protocol calls, canonical tool-list schemas,
strict output checks, inherited/overridden configuration, cancellation, and
concurrent repair reports. The filesystem integration test verifies repaired
scenario creation, canonical Markdown, native full-text indexing, checksum
conflicts, unchanged source bytes after rejected repairs, update, and deletion.

Dedicated parser suites cover all 12 entity repair shapes, recursive references,
fragment ordering, ambiguous names/unions, duplicate destinations, missing
required values, scalar coercion, duplicate JSON keys, byte/depth/node/repair
limits, and getter/proxy/cycle rejection. The ordinary framework, SQLite, search,
and lifecycle suites remain required gates.

Revisit these defaults when representative model traces show repeated false
matches or unrepairable layouts, a custom schema needs unsupported constructs,
or measured repair latency exceeds a host's budget. Functional tests are not a
corpus-scale benchmark or a statistical claim about model recovery rates.

## Links

- [Relaxed JSON guide](../relaxed-json.md).
- [MCP input boundary](../../src/lib/mcp-input.ts).
- [Effect repair pipeline](../../src/lib/json-repair/pipeline.ts).
- [Structure routing](../../src/lib/json-repair/name-mapper.ts).
- [Bounded syntax parser](../../src/lib/json-repair/syntax.ts).
- [Parser and MCP validation evidence](../validation.md).
- [Filesystem integration test](../../test/mcp-repair-filesystem.test.ts).
- [jsonrepair upstream documentation](https://github.com/josdejong/jsonrepair).
- [Filesystem commit contract](0001-filesystem-commit-and-reconciliation.md).
