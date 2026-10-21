# Ergonomics of the structree MCP surface for language models

## 1. Purpose

This document records what a language model experiences when it drives the structree MCP
server, and what could be changed to make that interaction cheaper, safer and easier to get
right.

**Revision note.** The first version of this document was put through an independent
adversarial review, which was asked to verify every claim against the implementation and
against the project's own design records. The review found that several findings were
accurate but overstated, that two of them misattributed a cause, and that the priority
ordering was wrong. This version is the corrected one. Where the review changed the
conclusion, the change is stated explicitly rather than quietly applied, and the source
that settles each point is named.

The observations were produced against the live server of this repository, on the vault that
holds the 275 objects created for the initial implementation, and every one of them is
reproducible with the tool call that produced it.

## 2. What already works

These properties were exercised heavily while filling the vault and should be preserved.

- **The checksum guard.** `update` and `delete` require the checksum of the revision they
  replace, so two writers cannot silently overwrite each other. The parameter description says
  where the value comes from: "Checksum returned by the latest get/list/create/update".
- **Schema errors are addressed to the caller.** A rejected call prints the offending path, the
  expectation, the arguments that were actually sent, and ends with "Update the arguments and
  call the tool again". That is exactly what a model needs to self-correct in one step.
- **Framework errors are structured.** `{"error":{"code","message","details"}}` with codes such
  as `ALREADY_EXISTS`, `NOT_FOUND`, `UNKNOWN_TYPE` and `VALIDATION` is machine-readable and
  stable.
- **The MCP boundary is strict about excess properties.** `src/lib/mcp-input.ts` builds both
  the advertised JSON Schema and the decoder with `onExcessProperty: "error"`, and the repair
  layer refuses unknown fields. The library's registry decode rejects them as well
  (`src/lib/registry.ts`).
- **The input repair is genuinely useful.** A scalar where a list is expected is coerced, and
  stringified containers are repaired before strict decoding.
- **Field-level semantics are in the schema.** Each relation field documents its own contract,
  for example "Required owning project identifier".
- **Search keeps its default response small.** Bodies are opt-in through `includeBody`.

## 3. How the observations were made, and what that limits

The measurements came through a client bridge rather than through a raw MCP request. That
bridge is not neutral, and two consequences matter for everything below.

- A call with a non-canonical key, `objects_search({Query: "checksum", ...})`, arrived at the
  server with the key gone, and the server reported `query: Missing key` while echoing an
  `Arguments provided` block that no longer contained `Query`. A flat create was echoed as
  `{}` despite many fields being sent. Something in the observed path discards keys it does
  not recognize before the server's own repair can use them.
- Because of that, an observed acceptance of an unknown field cannot be attributed to the
  server's boundary. The server's source, its tests and its build all say the opposite. The
  finding below is therefore stated as an open question about the observed path, not as a
  server defect.

Any fix in the server can also be defeated by the transport. That makes the bridge the first
thing to isolate, ahead of any change to the library.

## 4. Findings

### F1. Relation targets are not validated, and that is a documented design choice

`feature_create` with `relations.project: "no-such-project"` was accepted and stored, with no
issue and no warning.

The current identifier rule accepts caller ids in any case, lowercases them,
then refuses an invalid object, owner or relation-array identifier with
`VALIDATION` before any target is considered. This does not add
target-existence validation: a valid missing target is still stored after
lowercase normalization. See [decision 0013](decisions/0013-name-the-file-after-the-id.md)
for the portable stored-id domain applied after lowercasing below the tool boundary.

The first version of this document called that a defect. It is not. `docs/core-schemas.md`
states that "Required owner IDs do not imply target existence, inverse consistency, or
hierarchy/dependency cycle validation", and that "Cross-object validation can be added at an
application boundary if a host needs it". `test/schemas.test.ts` asserts that permissiveness.
The earlier project review classified the same point as intentionally absent, and the same
document says a link may legitimately be created before its target exists, which this vault
did: the ADRs were written before the scenarios they commit to.

Two corrections to the original text. The claim that there is "no way except listing every
object of the target type" was wrong: `get` on the id answers it directly, and the
`NOT_FOUND` error is precise. And "permanently broken" was wrong: creating the target
repairs the condition.

**Proposal.** Keep the library permissive. If a host wants link diagnostics, implement them at
the application boundary, where the project already says they belong, and never reject a
write on their account. Any such audit must distinguish an absent target from a duplicate, an
invalid or an unobservable one, because an incomplete scan cannot prove absence, which is
what the `duplicate-identity-excluded` and `incomplete-scan-no-deletion` contracts already
require of reconciliation.

### F2. The advertised schema and the enforced bounds disagree

The tool schema advertises `limit` with a maximum of `9007199254740991`, and the runtime
rejects anything above 1000:

```
project_list({ limit: 5000 })
-> VALIDATION: List limit must be 1..1000 and offset must be nonnegative integers.
```

`objects_search` has the same mismatch for `topN`: the schema advertises the same huge
maximum, and the runtime enforces `search.maxTopN`, which is 100 in this deployment and is
configurable. A model reads the schema, believes 5000 is acceptable, sends it, and is
rejected. Two of the most frequent parameters in the surface are described incorrectly. The
list default is 50, which the schema also does not state.

**Proposal.** Advertise the enforced bound and the default in the JSON Schema. The search
bound must reflect the effective configuration rather than a hardcoded number, since the
configuration is what an operator sets.

### F3. The default search mode is undocumented, and an unusable provider breaks it

`objects_search({ query: "probe" })` without a mode failed with `EMBEDDINGS_UNAVAILABLE`.

The first version of this document proposed a fallback to full-text whenever no provider is
configured. That fallback already exists: `src/lib/framework.ts` chooses
`request.mode ?? (this.provider ? "hybrid" : "fulltext")`. The real situation is narrower and
worse. A provider *is* configured here, the local override names `onnx`, and it is unusable
because no model snapshot is prepared. The default therefore selects hybrid, hybrid needs
vectors, and the call fails on a query that full-text would have answered.

**Proposal.** Document the default, and make the failure actionable: say which mode works
without a provider, and distinguish "no provider is configured" from "the configured provider
cannot run". Do not silently substitute full-text for a request that explicitly asked for
semantic or hybrid search, which the `search-bounds-enforced` contract already requires to
fail with `EMBEDDINGS_DISABLED`.

### F4. `objects_status` can flood the context, twice over

With 275 objects and no prepared model, the top-level `issues` array held 275 entries, 65,624
compact JSON characters, nearly all of them the same message. The complete status result was
132,077 characters, because the same issues also appear inside `lastSync.issues`. A single
status call can consume a large share of a session's context and bury the few fields a model
actually needs.

**Proposal.** Group issues by code, for example `{"EMBEDDING": 275}`, and apply the same
treatment inside `lastSync`. The full list stays available behind a flag. The first version of
this document quoted a token estimate; the character counts are the measured facts.

### F5. `objects_definitions` has no filter

The tool returns the canonical JSON Schema of all twelve types, 20,604 compact characters,
and takes no arguments.

The original text framed this as a mandatory introductory call. It is not: a model already
receives the relevant shape in the per-type tool definitions, so the avoidable cost is only
paid by a model that wants the full registry at once.

**Proposal.** Add an optional `type` argument, and a compact summary of the registry alongside
the full schemas.

### F6. The model must supply timestamps, and the run made that visible

`createdAt` and `updatedAt` are required fields on every create and update, so a model that
omits them gets "object.createdAt: Missing key".

The first version argued this forces a model to fabricate a timestamp, and that server
defaults are a small fix. Both halves were wrong. Required fields do not force invention: the
run used a single constant value for all 275 objects, so nothing was invented, and the
observable cost is different and worse than the original text said. Every one of the 275
objects now carries the same creation and update time, which is a data-quality artifact of
the run itself and a warning about what required timestamps do to a bulk import.

Server defaults are also not behavior-preserving. They change who owns `updatedAt` and they
change what a historical import can record, which is a decision rather than a correction.

**Proposal.** Offer server defaults as an explicit option for callers that want them, and
keep caller-supplied timestamps valid. The run's uniform timestamps are the stronger argument
for an explicit policy, and they are a property of this vault, not of the library.

### F7. Update replaces the whole revision

`project_update` takes `id`, the complete `object`, `body` and `expectedChecksum`, so the id
appears both at the top level and inside the object. The first version claimed every update
needs two calls. That is wrong when the caller already holds the revision, which is the case
after a create, a get or a list.

Full replacement is also deliberate. The design record for the MCP input boundary treats
replacement as the contract, and a partial update is a new API with obligations that have to
be decided: missing versus null, whether an array replaces or merges, which fields are
immutable, that the final state is validated strictly, and that the checksum guards the
read-modify-write pair.

**Proposal.** Treat partial update as an API decision with its own design record, not as a
correction to the current surface. Nothing in the current contract is broken.

### F8. There is no batch write, and the original cost estimate was inflated

Filling the vault took 275 individual create calls. The first version called that the
dominant cost of the interaction. It is not, at least not in the way the text implied: the
replay lanes looped over many creates inside a single execution and returned a summary, so an
MCP request per object is not a reasoning round trip per object. The run also needed three
rejected attempts, and the demonstrated need was bulk create, not a heterogeneous
create, update and delete batch.

**Proposal.** Defer batching until a caller shows the need. If it is added, per-item outcomes
matter, and prevalidating the whole batch before the first mutation is worth considering
before partial success, because partial success creates retry and dependency-handling
requirements.

### F9. `ALREADY_EXISTS` carries no details

A create with an existing id fails with `ALREADY_EXISTS` and empty `details`.

**Proposal.** Put the current checksum and path in `details`, but keep this off the urgent
list. A checksum does not supply the complete object, the immutable `createdAt` or the body
that a safe replacement needs, so advertising it as a way to skip reading risks encouraging a
blind overwrite.

### F10. An unknown field was accepted and dropped, and the responsible layer is not established

A create with an extra top-level field `extra` was accepted, and the stored object does not
contain it. The first version attributed this to the server boundary and proposed changing
it. That attribution was wrong, or at least unproven.

The server's MCP boundary builds its schema and its decoder with `onExcessProperty: "error"`,
the repair layer refuses unknown fields, and `test/mcp.test.ts` covers excess properties at
both the object and the envelope level. The library's registry decode rejects unknown fields
too, which is what the `unknown-fields-rejected` contract in this vault describes, and
`docs/configuration.md` promises rejection of unknown MCP fields before the facade runs.

The observed path, however, demonstrably discards keys it does not recognize. That is the
leading explanation for the accepted `extra`, and it is the same mechanism that stripped
`Query` from a search call.

**Proposal.** Isolate the transport before changing the server. The strict contract is not the
wrong side, and weakening registry decoding to match an observed client behavior would be the
wrong fix. A request trace that shows the raw bytes is what settles this.

### F11. The repair is asymmetric, and the observed failure was an orchestration error

A scalar where a list is expected is repaired; a one-element list where a string is expected
is rejected with "Expected string". The implementation wraps scalars into arrays and does not
unwrap arrays into strings.

The first version treated this as a schema-description defect, and the three rejected
acceptance criteria in the run as a consequence. The cause was the parent instruction. The
handoff specified `relations = {"scenario": [your scenario id], ...}` for a field the schema
defines as a single string, and the producer followed the instruction, so three creates were
rejected. The schema was clear, and the field descriptions could not have prevented the
mistake, because the mistake was made upstream of the schema.

**Proposal.** Documenting the shape in the field comment is still worth a line, and unwrapping
a one-element array is a defensible policy extension, since nothing is lost. But the incident
was an orchestration defect, not a surface defect, and the durable fix is in how work is
handed off.

### F12. `UNKNOWN_TYPE` does not list the valid types

`objects_search({ types: ["nope"] })` fails with "Unknown object type 'nope'" and
`details: {"type": "nope"}`. The first version's reproduction omitted the required `query`,
which would have failed earlier.

**Proposal.** Return the registered type names in `details`, and, better, publish the type
names as an enum in the tool schema so a wrong name is prevented before the call rather than
rejected after it.

### F13. The object model and the intended workflow are not stated in the surface

The observed surface was 64 tools, five per type for twelve types, plus search, resync,
status and definitions, with no shared statement of the object model or authoring order.
The current naming guidance in `objects_definitions` is:

> Object ids are stable, unique within their type, and are the only handle: the file name is the id, an id is always lowercase, and the scanner renames a file whose name does not match its id.

The shared guidance also separates description from Markdown body and states that
relation targets are not validated.

The first version proposed a new `objects_guide` tool. The review's alternative is better:
the guidance belongs in the existing descriptions and in the existing definitions endpoint,
not in a thirteenth kind of tool that a model has to discover.

**Proposal.** Put a short common workflow contract in the shared tool instructions: stable
typed ids, `get` for a known id, complete replacement plus a checksum, caller-owned
timestamps, and no referential enforcement. Extend `objects_definitions` with a compact
summary and a type selector. Present the relationship model as a small
`source field -> target type, cardinality` table, which `docs/core-schemas.md` already
contains in prose. Describe the authoring order as a suggestion, not a prerequisite for
consistency.

## 5. What the first version missed

1. **The observed path can defeat the server's own repair.** Keys the client does not
   recognize are discarded before the server sees them, which makes documented recovery
   unreachable and any server-side fix ineffective. This is more consequential than any
   repair extension, and it is the first thing to isolate.
2. **Listing is an expensive discovery primitive.** Every list returns complete objects with
   their bodies. Listing the 50 acceptance criteria produced about 47.7 KB, and the 16 ADRs
   about 47.8 KB. A compact identity, title and checksum projection would cut more routine
   context cost than any onboarding change.
3. **Search is not exhaustive, and a model cannot tell.** Results are capped by `topN`, there
   is no pagination, and stale hits are dropped without being refilled. A full-text hit
   carries no excerpt unless the body is requested, and `matchedChunk` is populated for
   semantic results only. A model that reads an empty result as "no such object" will be
   wrong.
4. **The demonstrated failure was a handoff race.** The producer kept rewriting its
   deliverable while the replay was already reading it, and the parent kept correcting it.
   Freezing a snapshot, identifying it, validating it and only then replaying is the
   durable fix, and it is cheaper than broadening the repair layer.
5. **A complete graph can still say the wrong thing.** Every relation target in this vault
   resolves, and one unit-test object still claimed to verify an OpenAI request while the
   test exercises the local ONNX provider. Reference existence is not evidence of meaning.

## 6. A playbook for a model using the surface today

1. Call `objects_status` once at the start and read the counts, not the issue list.
2. Call `objects_definitions` once, for the types you need, and keep them for the session.
3. Pass `mode: "fulltext"` unless a model snapshot is prepared, and never treat an empty
   search result as proof of absence.
4. Use kebab-case ids, unique within a type, and treat them as permanent.
5. For a known id, use `get`, not a listing.
6. Keep the checksum from every create, get and list response, and pass it to update and
   delete. Read before you write.
7. Use `includeBody` on search only when the body is actually needed, and prefer a targeted
   `get` to a whole-type listing.
8. Create in a sensible order, and remember that nothing enforces it: project, goal,
   feature, scenario, acceptance criteria, acceptance tests, then the other tests.
9. Expect to read a value back to confirm it, because the observed path can drop what it does
   not recognize.

## 7. Priorities

The original P0 list mixed a demonstrated defect with conveniences. The corrected order:

**First, isolate the transport.** Silent loss, or a path that discards keys before the server
can repair them, is the strongest integrity concern, and the responsible layer is not yet
established. Do not change the library before that is settled.

**Then the cheap truthfulness fixes.** The enforced bounds and defaults in the schema, the
documented search default with an actionable error, the grouped status output in both issue
arrays, the type names in `UNKNOWN_TYPE`, and a type enum in the tool schema.

**Then compact discovery.** A projection for list results and a type filter for
`objects_definitions`, both of which cut routine context cost.

**Then the workflow guidance**, in the existing descriptions and the existing definitions
endpoint rather than in a new tool.

**Optional, at an application boundary.** Link diagnostics and reverse reference lookup.
Useful for this graph-authoring workload, explicitly an added capability, and never a reason
to reject a write.

**Deferred pending a demonstrated need.** Timestamp defaults, partial update, and batch
writes. Each carries compatibility or design obligations larger than the problem it solves.

**Low.** The conflict checksum in `ALREADY_EXISTS`, and the field shape comments.

## 8. Notes on the evidence

The findings come from the live MCP server of this repository, using temporary probe objects
that were created and then deleted, and from the tool schemas as a client sees them. The vault
was returned to its 275 objects afterwards.

The original probes included a separator-bearing id and a mixed-case id. They
do not describe the current contract: callers may send ids in any case, and
create, get, update and delete lowercase object and relation identifiers before
checking the portable stored-id domain, which rejects separators. The file name
is `<id>.md`, corrected by reconciliation when it disagrees with the content.
A filesystem that folds case or normalizes names may spell the name differently
while the target still names the same file; that spelling is accepted, the file
stays unchanged and indexed at its actual path, and no issue is reported. Only a
different file holding the target name is a conflict: the object is excluded with
`RENAME_CONFLICT` and nothing is overwritten. See [decision 0013](decisions/0013-name-the-file-after-the-id.md).

One finding was corrected inside the vault itself. The `onnx-integration-test` unit-test object
claimed to verify the `openai-embedding-request` scenario while the test exercises the local
ONNX provider and no external endpoint; that claim has been removed and a note added that the
test is skipped unless a model configuration is supplied.

## 9. Implementation status

The changes that answer the findings below are implemented and recorded in
[ADR 0007](decisions/0007-advertise-effective-bounds-and-bound-status-output.md). The findings
and the omissions keep their original text, because they are the review's record of the
analysis; the measurements quoted in this document were taken before these changes.

`fixed` means the implementation answers the finding. `deferred` means the finding stands and no
change was made. `not applicable` means the finding describes a deliberate boundary rather
than a gap in the surface. `corrected` means the observation was about the observed path, and
the server's own behavior is the opposite of what was suspected.

### Findings

| Finding | Status | What the implementation does |
| --- | --- | --- |
| F1 | `not applicable` | Relation targets are still not validated for existence; invalid identifiers are refused before any target is considered, and valid missing targets are stored after lowercase normalization. The surface states it in the `guidance` array of `objects_definitions`: "Relation targets are not validated: a link to an object that does not exist is stored as written." Link diagnostics remain an application-boundary option and are not implemented. |
| F2 | `fixed` | The list and search input schemas are built per facade. The list `limit` is an integer from 1 to 1000 and defaults to 50, the list `offset` is 0 or more and defaults to 0, and the search `topN` is an integer from 1 to the configured `search.maxTopN` and defaults to the configured `search.defaultTopN`. A facade that exposes no search configuration advertises the built-in defaults, 100 and 10. |
| F3 | `fixed` | The `mode` description states that the default is hybrid when an embedding provider is configured and full-text otherwise. A provider failure keeps the `EMBEDDINGS_UNAVAILABLE` code and its cause, and the message ends with `Search with mode "fulltext" to query without embeddings.` An explicitly requested semantic or hybrid search is still never downgraded to full-text. |
| F4 | `fixed` | The status report lists at most 50 issues and adds `issuesTotal`, `issuesTruncated` and `issuesByCode`, a count per issue code; `lastSync` carries the same four fields. The stored report is not mutated, so the report returned by `objects_resync` still lists every issue. The 132,077-character status response measured in this document is the reason for the bound. |
| F5 | `fixed` | `objects_definitions` takes an optional `type` argument that returns a single definition; without it, it returns every registered type, and an unknown type fails with `UNKNOWN_TYPE`. Its output gained the `guidance` array, seven strings that publish the shared contract. A per-type summary table was not added; the type filter already lets a caller take one type at a time. |
| F6 | `deferred` | Caller-supplied timestamps stay required. A server default changes who owns `updatedAt` and what a historical import can record, which is a design decision rather than a correction, so it needs its own record. No change was made. |
| F7 | `deferred` | Full replacement remains the contract, with the checksum guard and the immutable id and `createdAt` unchanged. A partial update is a new API with its own obligations, so it is deferred. The current behavior is now published instead of implied: the `guidance` array states that update and delete replace the whole revision and need the checksum from the latest get, list, create or update. |
| F8 | `deferred` | No batch write was added. Per-item outcomes and the choice between prevalidation and partial success are a new API shape, deferred until a caller shows the need. |
| F9 | `deferred` | `ALREADY_EXISTS` still carries empty details. This is the low-priority item of the priority list: a checksum does not supply the complete object, the immutable `createdAt` or the body that a safe replacement needs. |
| F10 | `corrected` | Nothing was changed in the library. The server's MCP boundary builds its schema and its decoder with `onExcessProperty: "error"`, the repair layer refuses unknown fields, and the registry decode rejects them too, so the accepted `extra` belongs to the observed path, where the keys are lost. The first step is to isolate the transport. |
| F11 | `deferred` | The repair remains asymmetric: a scalar is wrapped into an array, and a one-element array is not unwrapped into a string. The incident was an orchestration error upstream of the schema, and the field-shape comment is a low-priority item. |
| F12 | `fixed` | The `UNKNOWN_TYPE` details carry `registeredTypes`, the sorted registered type names, next to the offending `type`; the code and the message are unchanged. The `types` parameter of `objects_search` is published as an enum of the registered type names, so an unknown name is rejected by input validation with the full list in the message, before the call reaches the framework. |
| F13 | `fixed` | The shared workflow is published in the `guidance` array of `objects_definitions`: the naming guidance quoted above, `get` for a known id, the complete replacement and its checksum, the caller-owned timestamps, and the absence of referential enforcement. Every per-type tool description ends with "See objects_definitions for the object model and workflow." The relationship model stays in `docs/core-schemas.md`, which also states the stored-id domain applied after lowercasing caller ids in any case and the type-name enum; it was not restructured into a cardinality table. |

### The five omissions of section 5

| Omission | Status | What the implementation does |
| --- | --- | --- |
| 1. The observed path can defeat the server's own repair | `corrected` | The server's boundary already rejects excess properties, so no library change was made for this. The keys are lost in the observed path, and isolating the transport is the first step, ahead of any library change. |
| 2. Listing is an expensive discovery primitive | `fixed` | Every per-type list tool takes an optional `includeBody` boolean that defaults to true; with it false the returned objects omit the `body` field and carry identity, title, path and checksum only. Measured on this repository's vault: the 16 ADRs fell from 47,811 to 12,378 characters, and the 24 unit tests from 43,783 to 16,455. |
| 3. Search is not exhaustive, and a model cannot tell | `fixed` | The current tool description states: Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The server's startup reconciliation runs in the background, so a search issued right after it starts may find nothing; objects_status reports whether a synchronization is still running. The body field is omitted unless includeBody is true. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction. |
| 4. The demonstrated failure was a handoff race | `not applicable` | The durable fix is in how work is handed off, not in the tool surface. Nothing in the implementation addresses it. |
| 5. A complete graph can still say the wrong thing | `not applicable` | The finding is about the content of a stored object rather than about the surface. The library deliberately does not validate relation targets, and section 8 records the correction that was made inside the vault. |

The playbook in section 6 still applies, and one of its steps is now cheaper: reading the counts
of `objects_status` is enough, because the response states the total, the truncation flag and
the per-code counts next to the bounded issue list.
