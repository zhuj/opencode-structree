---
status: accepted
date: "2026-10-21"
decision-makers:
  - User
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0011. Publish the observed surface and reject empty identifiers

## Decision summary

Publish the observed lexical overflow class, hybrid behavior without lexical
tokens, and retired-object listing and search rule. Keep the self-imposed
128-distinct-token cap and record why it exists. Reject empty object and relation
identifiers with `VALIDATION`, while preserving storage of non-empty identifiers
whose targets do not exist. Align the published descriptions, documentation and
agent skill with those decisions.

## Context and problem statement

Driving the live MCP surface on 2026-10-21 exposed three publication gaps:

- A query with 129 distinct tokens failed with `INTERNAL` and the message
  "Full-text search accepts at most 128 distinct tokens." Exactly 128 tokens
  were accepted, but the query description did not name the error class.
- A punctuation-only query had no lexical matches but still returned
  semantic-ranked hybrid hits. The mode description did not state this path.
- A feature with `retiredAt` set still appeared in its list and search results.
  The published text did not say that retirement marks rather than removes it.

The same session created and stored a feature with `project: ""`. This was an
identifier-validation gap, separate from checking whether a relation target
exists. The user chose to reject empty identifiers, not to add foreign-key
validation.

The lexical cap is not a SQLite limit. On 2026-10-21 SQLite 3.53.4 was measured
executing 2000 AND-joined and 5000 OR-joined terms without error. The framework's
128-token bound keeps its generated FTS5 MATCH expression bounded. Counting
happens on distinct extracted strings before SQLite's case and diacritic
folding, so case variants count separately.

## Decision drivers

- Make an agent's published guidance describe the behavior it can observe.
- Preserve the existing error class and retrieval behavior rather than silently
  changing them to fit incomplete wording.
- Bound generated lexical queries without silently truncating user intent.
- Refuse meaningless empty identifiers without requiring targets to exist first.
- Keep source annotations, current documentation, the agent skill and this
  decision aligned while preserving historical records.

## Considered options

1. **Publish the observed behavior, keep the cap, and reject empty identifiers.**
   Selected. Close the publication gaps and the identifier-validation gap without
   changing ranking, retirement filtering or target-existence policy.
2. **Reclassify lexical overflow as `VALIDATION`.** Rejected. Keep `INTERNAL`
   and name it explicitly in the query description and caller guidance.
3. **Raise or remove the 128-token cap.** Rejected. SQLite accepts larger
   expressions, but the framework still needs a self-imposed bound on generated
   queries; the measurement explains the rationale rather than requiring a new
   threshold.
4. **Hide retired objects from listings and search.** Rejected. Retirement is
   a field callers inspect, not an implicit filter or deletion operation.
5. **Keep accepting empty identifiers.** Rejected. A missing target can be
   meaningful while an empty handle cannot identify one.

## Decision outcome

When lexical evaluation runs, more than 128 distinct extracted tokens fails
with `INTERNAL`, rather than truncating the query. Callers shorten their own
over-limit query. The published query description now names the class; the cap
remains a bound on the generated FTS5 MATCH expression, not a SQLite capacity
claim. Counting stays before case and diacritic folding.

In hybrid mode, a query with no lexical tokens still runs semantic ranking.
Those hits carry no lexical evidence: `fulltextRank` is null and
`semanticDistance` is set. Provider requirements and errors remain in force;
this is not a fallback from a failed provider to fulltext.

A retired object remains listed and searchable. `retiredAt` marks it; callers
check the field to exclude it. Listing and search behavior did not change, only
the published text did.

Object ids, owner identifiers such as `relations.project`, and individual ids
inside relation arrays must not be empty. Empty strings are rejected with
`VALIDATION` before any target is considered. Empty relation arrays and explicit
nullable parents remain valid. Relation targets are still not validated for
existence: a non-empty identifier naming a target that does not exist is stored
as written. The shared `objects_definitions` guidance remains unchanged.

The source annotations are the authority for verbatim descriptions. Current
documentation and the skill copy those descriptions without rewriting their
punctuation or wrapping the string. Historical decisions remain historical;
the search-quality plan's final-description block is current text, while its
narrative remains the record of the investigation.

## Consequences

### Positive

- Agents can anticipate the overflow class, semantic-only hybrid hits, and
  retirement visibility from the published surface.
- Empty object, owner and relation-array identifiers fail early and consistently.
- Valid forward references remain possible without foreign-key validation.
- The cap's rationale is explicit and supported by the recorded SQLite probe.
- Retirement publication does not silently remove objects from discovery.

### Negative

- The published surface now grows: descriptions and supporting guidance must
  carry more of the observed contract and remain synchronized.
- Previously accepted empty identifiers are no longer valid; callers must send
  meaningful non-empty identifiers rather than empty placeholders.
- Overflow remains `INTERNAL`, so callers must distinguish an over-limit query
  from other internal failures and shorten that query themselves.
- Callers needing active-only results must inspect retirement themselves.

## Confirmation

The live observations and SQLite measurement above were supplied by the parent
session's investigation on 2026-10-21. This documentation lane did not repeat
them. The parent session owns live re-verification against the changed code.

This lane inspected `src/lib/mcp.ts`, `src/lib/base-schema.ts` and identifier
annotations under `src/schemas/`, then updated the current documentation and
skill. Grep checks compare the copied current query and mode descriptions with
their source and look for stale wording. Static inspection is not runtime proof.
No tests, server startup, model inference, downloads or MCP calls were performed
by this lane.

The parent session then re-verified the changed code at runtime on 2026-10-21.
A fresh stdio MCP server over the official client, with a temporary vault and the
pinned ONNX snapshot, reported 64 tools and confirmed each published statement:
the query description names `INTERNAL`; the mode description states the hybrid
fallback; the per-type list description states the retired-object rule; the `id`
argument description reads "Object identifier. Must not be empty."; a query with
129 distinct tokens failed with code `INTERNAL` and the message "Full-text search
accepts at most 128 distinct tokens."; a create with an empty `object.id` failed
with an input validation error naming `object.id`; a create with an empty
`object.relations.project` failed naming `object.relations.project`; a get with
an empty `id` failed naming `id`; a retired object remained in its listing with
its `retiredAt` set and remained a search hit; and a punctuation-only hybrid
query returned semantic-ranked hits with a null `fulltextRank` and a set
`semanticDistance`, while the same query in fulltext mode returned no hits. The
repository gate passed with 370 tests passing, 2 skipped, 0 failing and 2986
assertions across 24 files, and the stdio smoke check passed with 64 tools.

## Links

- [Prior search guidance decision](0008-search-query-and-availability-guidance.md).
- [Core schemas and published guidance](../core-schemas.md).
- [Literal queries in the object index](../database.md#literal-queries-in-the-object-index).
- [Search-quality plan](../search-quality-plan.md).
- [MCP descriptions](../../src/lib/mcp.ts).
- [Base identifier and retirement annotations](../../src/lib/base-schema.ts).
- [Agent skill](../../.opencode/skills/structree/SKILL.md).
