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

# 0009. Return bounded native full-text search excerpts

## Decision summary

Deliver P3a/P3b of the search-quality plan: add native lexical evidence through
an additive SQLite projection and optional public `fulltextExcerpt: string | null`.
Accept bounded name/title, frontmatter and body disclosure independently of
`includeBody`. Preserve the semantic `matchedChunk`, retrieval and body-field
opt-in contracts. Retain the current tokenizer, inputs, errors and tool count.

## Context and problem statement

Full-text hits previously exposed identities and ranks without textual evidence,
forcing callers to read each hit to discover why it matched. The index already
contains the matching text. The plan's runtime probe established identical
native `snippet()` behavior against the trigger-maintained FTS table under
better-sqlite3 and bun:sqlite, including raw YAML evidence for frontmatter-only
matches and complete short documents within a 32-token budget. That probe is
feasibility evidence, not a substitute for the wrapper and protocol regressions.

`matchedChunk` represents a semantic chunk with an index and actual raw-source
code-point coordinates. Native excerpts may come from decoded name/title text
and contain inserted omission markers, so they cannot truthfully reuse that shape.
The [plan's Decisions Closed and Excerpt Disclosure And Caller
Contract](../search-quality-plan.md#excerpt-disclosure-and-caller-contract)
close the output and disclosure choices for this milestone.

## Decision drivers

- Return useful discovery evidence without extra client reads or per-hit queries.
- Use SQLite's actual tokenizer/match instances rather than duplicate normalization.
- Preserve old SQLite callers, custom facade producers and semantic coordinates.
- Bound response size without implying confidentiality or exhaustive explanations.
- Keep the runtime, documentation, skill and caller-owned contracts aligned.

## Considered options

1. **Native FTS excerpt with a separate optional field.** Selected. It shares
   the MATCH/weighted BM25 statement, works across indexed columns and needs no
   dependency, query expansion or additional read.
2. **Application substring window.** Rejected because AND terms, folding,
   punctuation and decoded versus YAML-escaped labels require duplicating SQLite
   normalization and offset mapping, or would return misleading evidence.
3. **Highlight plus exact raw slice, or reuse `matchedChunk`.** Rejected for
   this slice. Highlight-to-offset mapping adds full-column work and marker
   collision handling; fabricated chunk indexes/offsets contradict the existing
   semantic contract, and parsed labels need not have a matching raw slice.
4. **Return no lexical evidence and require get for every hit.** Rejected
   because it preserves the measured discovery round trips.
5. **Body-only/title-first selection or excerpt redaction.** Rejected because
   it can hide a frontmatter-only match or misattribute the winning column.
   A confidentiality-preserving opt-in/redaction design would be a different
   contract, not a claim that a size cap or `includeBody: false` provides one.

## Decision outcome

`FTSExcerptRow<Row>` extends `FTSRow<Row>` with `readonly excerpt: string`.
`FTSIndex.searchRowsWithExcerpt(query, filter?, limit?)` uses a narrowly typed
private helper shared with `searchRows`. The same statement adds
`snippet(<quoted FTS table>, -1, '', '', '...', 32)` alongside weighted BM25.
The negative column argument requests automatic selection; markers are empty
except native `...` omissions. The fixed 32 is an FTS-token budget, not a
character or model-token limit. The separate reserved `fts excerpt` alias has
spaces like `fts lexical score`; explicit declared source-column projection
excludes retained extra aliases and materializes metadata outside `row`.
Identifiers remain quoted, query/filter values bound, and no caller-controlled
column argument or SQL is introduced. Old `search`/`searchRows` shapes remain.

| Hit | `fulltextExcerpt` From Concrete `SqliteIndex` | `matchedChunk` |
| --- | --- | --- |
| Full-text | Native excerpt, capped with `Array.from(text).slice(0, maxMatchCharacters).join("")` | Remains null |
| Hybrid with lexical contribution | Same lexical excerpt | Existing semantic chunk if there is a semantic contribution; otherwise null |
| Semantic-only hit, including one in hybrid | Null | Existing semantic chunk |

The public type adds `readonly fulltextExcerpt?: string | null`; the MCP schema
uses `Schema.optionalKey(Schema.NullOr(Schema.String))`. Older/custom producers
may omit it, meaning no excerpt was supplied, not absence of a lexical match.
The concrete index always emits it and determines availability from lexical
match presence, even when the fusion weight is zero. The public cap keeps the
first `search.maxMatchCharacters` Unicode code points, default 1200, after native
extraction. Surrogate pairs are never split; native markers count inside the cap.

`fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

Evidence has no coordinates, column provenance, HTML highlighting or fabricated
chunk index. Source markup is text, not sanitized HTML. It need not show every
AND term or literal spelling, identify the largest BM25 contribution, or remain
current after revalidation. A small cap or long token can hide the visible match.
`includeBody` controls only the `body` property. The existing checksum read drops
the entire rejected hit and excerpt, requests reconciliation and does not refill
topN. No extra per-hit read is added. Scores, ranks, filters, ordering, generation
and semantic offsets retain their meaning.

## Consequences

### Positive

- Lexical discovery carries useful source evidence in one indexed statement.
- Frontmatter-only matches remain explainable without inventing prose or offsets.
- Existing low-level callers and custom producers remain source/protocol compatible.
- Both drivers and the source/bundled protocol smoke exercise the real projection.

### Negative

- Responses grow, with at most 12,000 excerpt code points at default topN and cap,
  before JSON and other fields; custom bounds change that budget.
- Content can be disclosed independently of body-field opt-in, including an
  entire short document. Deployments prohibiting this must reopen the decision.
- A bounded excerpt is discovery evidence, not a complete match explanation or
  exhaustive search. Complete current context can still require get.
- Authoritative vault closure is caller-owned. This implementation does not
  mutate the vault or claim that repository gates verify its recorded contracts.

## Confirmation

`test/search-abstraction.test.ts` exercises both drivers, comparing old/new
identities, source rows, raw scores, ordering, filters and limits on the same
corpus, including punctuation, accents, duplicate terms and repeated matches.
It checks unchanged old shapes, trigger/extractor freshness and source/retained
alias collisions. `test/sqlite.test.ts` covers name/title/body/frontmatter evidence,
whole-short-document disclosure, body opt-in, configured/astral code-point bounds,
hybrid lexical-only candidates and zero-weight availability. Semantic-only hits
keep null excerpts and unchanged chunks.

`test/framework.test.ts` covers projection through actual source files, body
omission, semantic-only hybrid chunks, and changed/missing source rejection with
no refill and exactly the existing checksum read per candidate. `test/mcp.test.ts`
checks the advertised optional string/null schema, accepted absence and supplied
values, rejection of other types, unchanged 64 tools and the exact disclosure.
`test/library-boundary.test.ts` keeps a typed custom producer without the field
valid. `scripts/smoke-stdio.py` asserts lexical evidence on its existing real
full-text hit and reports `lexical_excerpt: passed` for source and bundle runs.

Delivery verification on 2026-10-21 from the repository root:

- RED: `bun test test/search-abstraction.test.ts test/sqlite.test.ts` failed
  the 12 new both-driver excerpt cases because the method/field did not exist;
  58 existing tests passed. The subsequent protocol regression failed on the
  missing disclosure sentence before it was appended. The two existing exact
  search-description assertions were updated to require the complete new text.
- GREEN: `bun test test/search-abstraction.test.ts test/cache-abstraction.test.ts test/sqlite.test.ts test/framework.test.ts test/mcp.test.ts test/library-boundary.test.ts`
  passed 128 tests with 1334 assertions and no failures.
- `bun run check` passed Biome (103 files), strict TypeScript, 364 tests with
  2928 assertions and source stdio smoke, which reported `lexical_excerpt: passed`.
  Two existing opt-in ONNX tests remained skipped; there were no failures.
- `bun run smoke:build` bundled 60 modules and passed stdio smoke, explicitly
  reporting `lexical_excerpt: passed` alongside 64 tools, CRUD, input repairs,
  EOF shutdown and crashed-lock recovery. Its bundled-hit command is
  `OBJECT_MCP_CLI=dist/cli.js bun run smoke`; the smoke checks a real fulltext
  hit's string excerpt containing `verification`, the default cap, omitted body
  and null semantic chunk rather than merely inspecting the bundle text.

Fixtures use isolated temporary storage and disabled or deterministic providers;
no real model readiness, live-vault closure or production latency is claimed.

## Links

- [Search-quality plan](../search-quality-plan.md).
- [Prior search guidance decision](0008-search-query-and-availability-guidance.md).
- [Database guide](../database.md).
- [Reusable library guide](../library.md).
- [Core schema reference](../core-schemas.md).
- [Embedding semantics](../embeddings.md).
- [Native FTS projection](../../src/lib/sqlite/fts-index.ts).
- [Index projection](../../src/lib/sqlite/index.ts).
- [MCP schemas and descriptions](../../src/lib/mcp.ts).
