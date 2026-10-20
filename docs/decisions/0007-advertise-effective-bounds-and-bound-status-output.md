---
status: accepted
date: "2026-10-20"
decision-makers: ["User"]
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0007. Advertise the effective bounds and bound the status output

## Decision summary

Make the MCP tool surface state the bounds it enforces, keep the status
report inside a bounded size while reporting what the bound left out, carry the
registered type names with the errors that need them, publish the shared object
model and workflow once in the existing definitions endpoint, and let the list
tools omit the Markdown body.

The advertised JSON Schema is now built per facade, so `limit`, `offset` and
`topN` state the effective limits and defaults. The status report lists at most
50 issues and adds `issuesTotal`, `issuesTruncated` and `issuesByCode`. An
unknown type error carries `registeredTypes`, and the search tool publishes the
type names as an enum. `objects_definitions` takes an optional `type` argument
and returns a `guidance` array with the shared workflow. Every per-type list
tool accepts `includeBody`, defaulting to true.

This follows the language-model ergonomics review of this repository's MCP
surface, recorded in [the ergonomics proposal](../llm-ergonomics-proposal.md).
The review found that the advertised schema and the enforced bounds disagreed,
that the status response duplicated its issue list, that a wrong type name
produced an error that did not name the valid types, and that nothing in the
surface explained the object model or the intended workflow.

## Context and problem statement

The generated tools published their input schemas once, at module load, with no
knowledge of the facade they would serve. The list `limit` was therefore
advertised with the maximum safe integer, 9007199254740991, and the search
`topN` with the same, while the runtime rejected anything above 1000 and above
the configured `search.maxTopN` respectively. A model that read the schema,
sent `limit: 5000`, and was rejected with a `VALIDATION` error was following
the advertisement. The enforced list default of 50 and the search default were
not stated at all.

The status report was not bounded. With 275 known embedding issues on this
repository's vault, `objects_status` returned 132,077 characters, because the
same issues appeared at the top level and again inside `lastSync.issues`. A
single status call could consume a large share of a session's context, and the
duplicated list made the size twice what it needed to be.

A wrong type name produced `UNKNOWN_TYPE` with `details: {"type": "nope"}`. The
only correction a caller can make is to use a registered name, and the error
did not carry one.

Nothing in the tool surface stated the object model. The stable id and the
hashed file name, the separation of `description` from the Markdown body, the
whole-revision replacement rule, the caller-owned timestamps, the absence of
referential enforcement, and the intended authoring order were all implicit in
the implementation and in prose elsewhere in the repository, and none of it
reachable from the tools themselves.

## Decision drivers

- The advertised schema must not describe a bound the runtime rejects.
- A published bound must reflect the effective configuration, because the
  configuration is what an operator sets.
- A bounded response must say that it is bounded and what the bound removed.
  Silent truncation makes a count silently wrong.
- An error that names a wrong identifier must also name the valid ones.
- The shared workflow belongs where the model already looks for the object
  model, not in a thirteenth kind of tool it has to discover.
- A discovery call should be able to return identity without the payload that
  dominates its size.
- New API shapes are not corrections to a broken contract and must not be
  smuggled in with them.

## Considered options

1. **Hardcode the bounds in the schema.** The simplest fix, and the wrong one
   for search: `search.maxTopN` and `search.defaultTopN` are operator-set
   configuration, and a hardcoded maximum would be wrong in exactly the
   deployments where the operator has tuned it. The bounds are therefore built
   per facade, from `facade.config.search` with the built-in defaults of 100
   and 10 as the fallback for a facade that exposes no configuration. The list
   bounds are constants, so they are published from the same constants the
   runtime validates against.
2. **Truncate the issue list silently.** Cheapest, and it makes the response
   lie: a model reading 50 issues would read 50 as the total. The bound is
   published together with `issuesTotal`, `issuesTruncated` and the per-code
   counts, so the truncated remainder is described rather than dropped.
3. **Add a separate guide tool.** The review's own first proposal was a
   thirteenth tool, `objects_guide`. `objects_definitions` already exists, is
   already the place a model looks for the object model, and already returns
   one entry per registered type. The workflow contract is published there as a
   `guidance` array, and each per-type tool description ends with a short
   clause pointing at it. A separate tool would add a discovery step rather
   than remove one.
4. **Add a partial-update or batch-write API.** Both were considered together
   with the truthfulness fixes and rejected for the same reason. Full
   replacement is the documented contract of the input boundary, and a partial
   update is a new API with its own obligations: missing versus null, whether
   an array replaces or merges, which fields are immutable, and how the
   checksum guards the read-modify-write pair. A batch write needs per-item
   outcomes and a decision about prevalidation versus partial success. Neither
   corrects a broken contract, so both are deferred to their own design
   records.
5. **Correct the tool surface as implemented, in the same change.** Selected.
   The changes are confined to the advertised schema, the published error
   details, the status response and the tool descriptions, and every one of
   them is a statement about behavior the implementation already has or a
   bound on output the implementation already needed.

## Decision outcome

The list and search input schemas are built per facade in `src/lib/mcp.ts`.
The list `limit` is an integer from 1 to 1000 described as "Maximum objects to
return, 1 to 1000. Defaults to 50."; the list `offset` is an integer of at least
0 described as "Number of objects to skip in identifier order. Defaults to 0.";
and the search `topN` is an integer from 1 to the effective `search.maxTopN`
described as "Maximum number of distinct matching objects, 1 to <maxTopN>.
Defaults to <defaultTopN>.". A facade that exposes no search configuration
falls back to the built-in defaults, so the published bound is 100 and the
published default is 10.

The search `mode` description states the default rule: hybrid when an
embedding provider is configured, full-text otherwise. When the provider is
configured but fails, the error keeps its `EMBEDDINGS_UNAVAILABLE` code and its
cause, and its message ends with `Search with mode "fulltext" to query without
embeddings.` An explicitly requested semantic or hybrid search is still never
downgraded to full-text.

The status report lists the first 50 issues and adds `issuesTotal`,
`issuesTruncated` and `issuesByCode`, a count per issue code. The `lastSync`
value carries the same four fields. The stored report is not mutated, so the
report returned by `objects_resync` still lists every issue.

An unknown type error keeps its `UNKNOWN_TYPE` code and its message, and its
details now carry `registeredTypes`, the sorted registered type names, next to
the offending `type`. The search tool publishes the type names as an enum, so
an unknown name is rejected by input validation, with the full list in the
message, before the call reaches the framework.

`objects_definitions` takes an optional `type` argument. Without it, it
returns every registered type; with it, it returns that one definition; an
unknown type fails with the existing `UNKNOWN_TYPE` error. Its output gained a
`guidance` array of seven strings: the ids are stable and the file name is a
hash of the id; use the type's get tool for a known id; update and delete
replace the whole revision and need the checksum from the latest get, list,
create or update; timestamps are supplied by the caller and the id and
`createdAt` are immutable; relation targets are not validated; the
`description` field is a one-line summary and the body is the Markdown content;
search is not exhaustive, so confirm a known id with get.

Every per-type list tool takes an optional `includeBody` boolean that defaults
to true. With it false the returned objects omit the `body` field, so a caller
can get identity, title, path and checksum only.

## Consequences

### Positive

- The advertised bounds and the enforced bounds are the same numbers, and the
  search bound follows the configuration an operator set.
- The status response is bounded, and the bound is visible in the response
  itself through the total, the flag and the per-code counts.
- The resync report is unchanged and still complete, so nothing is lost by
  the bound on the status copy.
- A wrong type name now yields the valid names, both in the error details and
  in the schema's enum.
- The object model and the workflow are reachable from the tools, in the
  endpoint a model already calls for the schemas.
- A listing can be answered at a fraction of its former size: on this
  repository's vault, the 16 ADRs fell from 47,811 to 12,378 characters and the
  24 unit tests from 43,783 to 16,455.

### Negative

- The tool list grew by a small constant clause per tool: every per-type
  description ends with "See objects_definitions for the object model and
  workflow.", and every list description explains `includeBody`.
- The status response is no longer a complete issue log, and a caller that
  needs every issue must read the resync report instead.
- The type names are published as an enum, so adding a registration changes
  the advertised schema and the framework must be restarted for clients to see
  it, the same as any other registry change.
- A facade that exposes no search configuration advertises the built-in
  defaults, which are not necessarily the defaults of the host that owns it.
- Partial update, batch writes, server-side timestamp defaults and link
  diagnostics remain unimplemented, and none of them is addressed by this
  change.

## Confirmation

The MCP suite asserts the advertised bounds and descriptions, the configured
search bound of 42 with a default of 7, the fallback bound of 100 with a
default of 10, the mode default rule, and the type enum. It asserts that
`objects_definitions` lists twelve types without an argument, returns one
definition with it, returns the seven guidance strings, and fails with
`UNKNOWN_TYPE` for an unknown type. It asserts that every per-type tool
description points at the published workflow, and that `includeBody: false`
omits the body while keeping the path, the checksum and the object identity.

The framework suite asserts that the status report lists 50 of 60 issues with
`issuesTotal` 60, `issuesTruncated` true and the per-code counts, that
`lastSync` carries the same four fields, and that a second resync still returns
all 60 issues. It asserts that a provider failure keeps the
`EMBEDDINGS_UNAVAILABLE` code, names the provider error, and ends with the
full-text hint, and that an unknown type error carries the sorted registered
names.

A protocol-level probe against the built bundle confirmed the published
schemas, the bounded status and the resync report's completeness. The current
measurement is recorded in [validation evidence](../validation.md).

## Links

- [Language-model ergonomics proposal](../llm-ergonomics-proposal.md).
- [Reusable library guide](../library.md).
- [Core schema reference](../core-schemas.md).
- [Generated MCP tools](../../src/lib/mcp.ts).
- [Framework composition](../../src/lib/framework.ts).
- [Object registry](../../src/lib/registry.ts).
- [Shared contracts and bounds](../../src/lib/types.ts).
- [MCP tool suite](../../test/mcp.test.ts).
- [Framework suite](../../test/framework.test.ts).
- [Validation evidence](../validation.md).
- [Input repair decision](0005-repair-mcp-inputs-before-effect-validation.md).
- [Library and vault decision](0006-extract-library-and-adopt-vault.md).
