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

# 0008. Publish truthful search query and availability guidance

## Decision summary

Publish the P1/P2 search-quality plan's exact query, type-filter, mode, search
and status descriptions. Align the documentation and agent skill with that
surface. Preserve retrieval, ranking, tool count, validation, errors and all
input/output shapes. Retain the current tokenizer and add no readiness field.

## Context and problem statement

The old surface called full-text words literal without explaining AND token
semantics, folding, punctuation, the distinct-token limit or searchable fields.
Agents could mistake quotes for phrases, asterisks for prefixes, operators for
syntax, or a type filter for additional indexed content. Search absence could
be mistaken for source absence. A configured embedding provider could be
mistaken for a usable one even though local ONNX loading is lazy and status
does not test inference.

The [search-quality plan](../search-quality-plan.md), especially Decisions
Closed and its Final MCP Descriptions After P1 And P2, supplies the accepted
wording and separate milestone boundaries. This record covers guidance only.

## Decision drivers

- Teach useful queries from the advertised schema itself.
- Describe the existing implementation rather than change successful ranking.
- Distinguish filtering from content and configured identity from usability.
- Preserve explicit embedding-free recovery without silent fallback.
- Keep bounded discovery separate from source-backed reads and enumeration.
- Keep tool, documentation, skill and recorded contracts aligned.

## Considered options

1. **Keep vague literal-word guidance.** Rejected because agents still have to
   guess phrase, prefix, operator and normalization behavior.
2. **Change parsing, add prefix syntax or index type/directory names.** Rejected
   because these change retrieval semantics rather than explain them, and type
   enumeration already has a source-backed list operation.
3. **Change to Porter stemming.** Rejected for this delivery. The plan's measured
   probe does not fix reconcile versus reconciliation; suffix gains elsewhere
   do not justify changed rankings, tokenizer compatibility and rebuild work.
4. **Add readiness from snapshot presence or probe inference in status.** Rejected
   because files and metadata cannot guarantee inference, the provider interface
   has no readiness capability, and a probe can load models or perform outbound
   work. Historical provider outcomes would need a separate contract.
5. **Silently fall back to fulltext or require resync before investigation.**
   Rejected because fallback hides the selected mode's failure and resync writes
   derived state. Explicit fulltext and source-backed reads already exist.
6. **Publish exact truthful guidance with regression evidence.** Selected. This
   closes the usability gap without a retrieval or shape change.

## Decision outcome

The five exact descriptions are reproduced in [the core schema
reference](../core-schemas.md#search-and-status-guidance), README, library guide
and agent guidance, and asserted at the MCP protocol boundary for facades with
and without configuration. Their source of truth for this milestone is the
plan's Final MCP Descriptions After P1 And P2 section.

Lexical evaluation extracts Unicode letter/number/mark runs, deduplicates
identical extracted strings before SQLite normalization, quotes them and joins
them with AND. It uses `unicode61 remove_diacritics 2`, without stemming.
Quotes and punctuation separate tokens; an asterisk leaves a plain token.
AND/OR/NOT are required literal words. Name, title and complete raw YAML
Markdown are searched; registered type and directory names are not injected.
More than 128 distinct extracted tokens fails rather than truncates and is
currently surfaced as `INTERNAL`, not `VALIDATION`. Nonblank punctuation-only
input yields no lexical candidates; hybrid can still fail at its provider first.

The default mode follows the provider instance, not a configured label's
usability. Semantic and hybrid keep `EMBEDDINGS_DISABLED` without a provider
and `EMBEDDINGS_UNAVAILABLE` on query embedding rejection. Explicit fulltext
does not invoke the provider. Validated `types: []` returns no hits before any
provider invocation. Filtering precedes ranking limits in both methods.

Search rechecks source checksums, drops stale or unreadable candidates and
requests reconciliation without refilling `topN`. A known id goes to get;
enumeration uses a complete successful paginated source list. Neither absence
from search nor revalidation proves exhaustive discovery or future freshness.
No resync write is required for read-only investigation.

Status keeps its existing shape: synchronization/index state, configured provider
label, fingerprint/dimensions metadata, historical reports and bounded known
issues with total, truncation and per-code counts. It checks neither model files
nor inference. Zero pending embeddings and `dirty: false` are not certificates
of usability or complete discovery. Resync writes derived state and returns the
full issue list. There is no new readiness or history field.

## Consequences

### Positive

- Agents can choose content tokens, type filters and explicit fulltext without
  guessing undocumented syntax or provider health.
- Existing ranking, validation, errors and shapes remain unchanged.
- Known ids and source enumeration provide an honest alternative to bounded
  discovery without forcing a write.
- Executable assertions prevent the published semantics drifting unnoticed.

### Negative

- Descriptions consume more tool-list context.
- No recall improvement, stemming, prefix matching or lexical excerpt is added.
- Provider status is not a health verdict; an actual query may still fail.
- Lexical token overflow remains `INTERNAL`; this guidance does not reclassify it.
- Authoritative vault closure is caller-owned and must accompany release; this
  implementation does not mutate the vault or claim that tests verify its text.

## Confirmation

`test/mcp.test.ts` asserts all five exact descriptions for configured and
configuration-free facades, alongside existing bounds, enums and tool counts.
`test/sqlite.test.ts` asserts exact encoder expressions, deduplication and
pre-folding token limits, then exercises AND, quote, prefix, operator,
punctuation, Unicode folding and type-filter semantics on both SQLite drivers.
`test/framework.test.ts` covers both semantic/hybrid provider-failure and
disabled-provider errors, explicit fulltext recovery, validated empty-type
short-circuiting and `INTERNAL` overflow. Existing checksum/stale-candidate
coverage remains unchanged.

Delivery verification on 2026-10-21 used isolated fixtures and deterministic or
disabled providers, without model preparation or network access:

- `bun test test/mcp.test.ts test/sqlite.test.ts test/framework.test.ts` passed
  69 tests with 574 assertions. Before replacing the descriptions, that command
  failed the three MCP advertisement cases while the behavior tests passed.
- `bun run check` passed Biome, strict TypeScript, 348 tests with 2492 assertions
  and source stdio smoke. The two existing opt-in ONNX tests remained skipped;
  real model readiness was not tested. An initial typecheck failure in the new
  optional-types test helper was fixed before the passing full run.
- `bun run smoke:build` bundled 60 modules and passed the bundled stdio smoke,
  including the unchanged 64-tool count, CRUD/search and shutdown/recovery.
- A read-only comparison extracted the five planned descriptions and found
  their exact text (accounting for JavaScript string escaping) in `dist/cli.js`.
  It also found all five verbatim in README, core schemas, library guide, skill
  and tool reference.

These checks establish the guidance and mocked failure behavior, not successful
inference with a real provider or completion of the caller-owned vault closure.

## Links

- [Search-quality plan](../search-quality-plan.md).
- [Core schema reference](../core-schemas.md).
- [Reusable library guide](../library.md).
- [Database guide](../database.md).
- [Embedding semantics](../embeddings.md).
- [Generated MCP tools](../../src/lib/mcp.ts).
- [MCP suite](../../test/mcp.test.ts).
- [SQLite suite](../../test/sqlite.test.ts).
- [Framework suite](../../test/framework.test.ts).
- [Effective bounds and status output decision](0007-advertise-effective-bounds-and-bound-status-output.md).
