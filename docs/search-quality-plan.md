# Implementation Plan: Search Quality Fixes

## Overview

Make full-text discovery easier to use without disturbing the ranking that already works. Ship accurate query, type-filter, availability, and freshness guidance first; add lexical excerpts after an explicit output-contract decision. Keep the existing tokenizer by default, and do not introduce a readiness claim that the provider interface cannot establish.

**Plan node:** `search-quality-fixes`. **Workload:** `implementation-plan-roadmap`.

**Baseline:** `master`, revision `440e27018a83ed6c70b48f195dd710d3809bd508`, inspected on 2026-10-20. The supplied live-vault measurements are observations, not newly executed tests. Source references below use this revision's line numbers.

**Artifact contract:** This file is the sole planning artifact. The caller owns execution tracking. Writing this plan does not authorize implementation, configuration changes, vault writes, model preparation, or checks. No tests, builds, server processes, network calls, or vault mutations were performed for this plan.

## Requirements And Scope

| ID | Requirement | Priority | Observable Acceptance |
| --- | --- | --- | --- |
| R1 / F3 | State the actual lexical query semantics and searchable fields. | Must | Given the advertised schema, an agent can identify AND semantics, punctuation handling, absence of phrase/prefix/operator interpretation, and the current lack of stemming without another read. |
| R2 / F4 | Distinguish content search from filtering by object kind. | Must | Given a kind-only discovery task, guidance directs the agent to `types` and, for enumeration, the per-type paginated list rather than requiring the kind's words in `query`. |
| R3 / F5 | Describe provider requirements and eventual consistency truthfully. | Must | Given an unavailable provider or an absent search result, the surface explains explicit full-text recovery and exact `get`/listing confirmation; configuration is never described as model readiness. |
| R4 / F1 | Return bounded lexical evidence without per-hit client reads. | Should, owner-gated | Given a lexical hit in a body, title/name, description, or relation id, search returns a useful bounded excerpt while preserving scores, ordering, filtering, semantic offsets, and body opt-in. |
| R5 / F2 | Decide whether stemming is worth a tokenizer/rebuild contract. | Could, owner-gated | Existing deployments keep the current tokenizer and rankings unless an operator explicitly selects and rebuilds for another tokenizer. No source object migration occurs. |
| R6 | Keep tool contracts, ADRs, documentation, vault, and skill aligned. | Must | Each delivered slice has matching contracts and verification evidence, with no future behavior presented as implemented. |

**Performance:** No numerical latency target or rebuild duration has been supplied or measured. Preserve the single lexical SQL query, existing candidate bounds, and deterministic ranking. Do not add per-hit SQL/filesystem reads for excerpts or model probes to `status()`.

**Security and availability:** No new outbound work, dependencies, lockfile changes, model downloads, or implicit fallbacks. Preserve validation and checksum revalidation. Excerpts can reveal bounded frontmatter/body content even when `includeBody` is false; that is an explicit disclosure/contract decision, not a hidden consequence.

**Maintainability:** Effect 4 schemas, strict types, no new `any` or suppressions; extend the existing SQLite/framework/MCP layers rather than adding a service or search engine. Keep SQL in `FTSIndex`, fusion/projection in `SqliteIndex`, provider policy in `ObjectFramework`, and wire schemas/descriptions in `mcp.ts`.

**Out of scope:** Fuzzy search, synonyms, raw FTS syntax, prefix matching, automatic query expansion, indexing type names/directories, changed BM25 weights, result pagination, new embedding models/providers, silent semantic-to-full-text fallback, automatic object migration, automatic cache deletion, general diagnostics redesign, unrelated cleanup, or production benchmarking. Missing models are an environment limit, not an implementation defect to repair here.

## Verified Baseline

| Evidence | Implementation And Consequence |
| --- | --- |
| E1: indexed fields and tokenizer | `src/lib/sqlite/cache-database.ts:40`, `:46`, `:50`, `:51`, `:52`: `ObjectMetadataTable` indexes `name`, `title`, `raw`, weighted **3, 5, 1**, with `unicode61 remove_diacritics 2`. `object_type` and `path` are metadata, not indexed columns. A kind's words can still match incidentally if present in object content. |
| E2: literal query encoding | `src/lib/sqlite/fts-index.ts:279`: `literalFtsQuery` extracts distinct Unicode letter/number/mark runs, quotes each, and joins them with `AND`. No tokens returns no lexical matches; more than 128 distinct tokens throws. This is not exact substring search. |
| E3: ranking and returned row | `src/lib/sqlite/fts-index.ts:207`, `:222`, `:226`, `:234`: `searchRows` selects all declared source columns plus weighted BM25 and returns `{ row, lexical_score }`. SQL orders ascending BM25 with configured tie-break columns. It requests no excerpt. `MetadataRow` already carries `name`, `title`, `raw`, and `body` at `src/lib/sqlite/cache-database.ts:11`. |
| E4: lexical/semantic projection | `src/lib/sqlite/index.ts:279`, `:290`, `:296`, `:318`, `:367`, `:386`: `SqliteIndex.search` negates BM25 for full-text scores; hybrid uses configured reciprocal ranks. `matchedChunk` is populated only from `SemanticMatch`, through **SqliteIndex.matchExcerpt**, not by the framework. It preserves chunk index and raw-source code-point offsets, then caps text. |
| E5: existing chunk meaning | `src/lib/types.ts:168`, `src/lib/mcp.ts:84`, `docs/embeddings.md:5`, `test/sqlite.test.ts:318`: `matchedChunk` has `{ index, start, end, text }`; chunk zero represents the complete raw file, and offsets are Unicode code points into that file. A snippet from a name/title, or one containing inserted ellipses, cannot truthfully be given arbitrary raw-source offsets. |
| E6: raw text is YAML Markdown | `src/lib/vault/codec.ts:51`, `:85`, `:94`, `:101`: parsing retains the raw document; serialization writes YAML frontmatter plus Markdown body. `src/lib/sqlite/index.ts:110` stores `document.raw` separately from canonical JSON. Therefore descriptions and relation ids are searchable through **raw frontmatter**, not because the separate `json` column is indexed. JSON-shaped values in the observed vault do not make the general format JSON frontmatter. |
| E7: public validation | `src/lib/mcp.ts:44`, `:61`, `:70`, `:73` constructs effective search bounds and registered type enums. `src/lib/framework.ts:440` rejects blank queries, validates registered types/modes/topN, and short-circuits empty type subsets. Do not reimplement observation 7 as a new fix. |
| E8: defaults and errors | `src/lib/framework.ts:445`, `:457`, `:466`: default mode is hybrid when a provider instance exists, full-text otherwise; semantic/hybrid requests normally require that instance. Provider failures become `EMBEDDINGS_UNAVAILABLE` with a full-text remedy; absence becomes `EMBEDDINGS_DISABLED`. The empty-`types` path returns before invoking the provider. |
| E9: freshness is not exhaustive | `src/lib/framework.ts:475`, `:480`: the framework rereads each candidate file, discards a changed/missing hit, and requests reconciliation. It does **not** refill removed hits to `topN`. This protects returned hits but cannot discover a newly unindexed object. `get` reads the source directly at `:266`; `list` scans source files at `:315`. |
| E10: status is not a readiness probe | `src/lib/framework.ts:491`, `:499`, `:501`: status has `syncing`, `dirty`, counts, issues, last reports, and `embeddings.{provider,fingerprint,dimensions}`. It does not inspect model files or execute inference. `src/lib/types.ts:58` gives providers dimensions/fingerprint/embed/close only, with no readiness capability. Injected providers can also differ from the configured provider label (`src/lib/framework.ts:150`). |
| E11: lazy ONNX loading | `src/lib/embeddings/onnx.ts:101`, `:118`, `:160`, `:163`, `:223`: a model-id provider is constructed before lazy model loading. `src/lib/embeddings/model-cache.ts:19`, `:31`, `:33`, `:34` checks required snapshot files on resolution in local-only mode; the other branch calls `fetch` at `:48`. File presence is not proof of successful tokenizer/model/device loading. |
| E12: incompatibility protection | `src/lib/sqlite/fts-index.ts:12`, `:97`, `:119`, `:122`: wrapper options support `porter unicode61`, but existing layouts/tokenizers must match exactly or startup fails requiring an explicit migration/rebuild. `src/lib/sqlite/cache-database.ts:251` also protects ownership/schema versions. Resync only upserts/reconciles documents (`src/lib/framework.ts:353`); it cannot reopen a cache whose initialization already failed. |
| E13: configured excerpt cap | `src/lib/config.ts:91`, `:150`, `:157`: `maxMatchCharacters` is a validated positive integer, default 1200. Search defaults are 10 results, maximum 100, candidate multiplier 5. These are defaults, not universal bounds for custom facades/configurations. |
| E14: current guidance already partly exists | `src/lib/mcp.ts:62`, `:66`, `:137`, `:383`, `:413` already mention literal words, default mode, nonexhaustiveness, synchronized indexing, and embedding status. The missing information is the precise semantics and the distinction between configured and usable embeddings. `.opencode/skills/structree/references/tool-reference.md:99` already warns about provider errors and recent changes. |
| E15: gates and ADR policy | `package.json:25`, `:28`, `:29`: `bun run check` runs Biome, TypeScript, ordinary tests, and source stdio smoke; `bun run smoke:build` builds and repeats smoke against the bundle. `docs/decisions/README.md:13`, `:15` has records through 0007 and says to add records rather than rewrite accepted history. |

### How The Measurements Constrain The Plan

The supplied 282-object experiment found sensible deterministic ranking for `reconciliation` and `checksum`, no full-text excerpts, missing variant matches, kind-word confusion, and unusable semantic/hybrid modes without the model/provider. Preserve that good ranking for all non-tokenizer changes. Do not encode the reported rounded scores or current live corpus size into brittle tests: adding or updating vault objects changes BM25 corpus statistics even with unchanged code.

Three qualifications prevent misleading promises:

1. `reconcil*` is converted to the token `reconcil`, not interpreted as a wildcard. Quotes are discarded as punctuation: `"acceptance criteria"` means both words anywhere, **not** a phrase and **not** a query that must always fail. `OR` becomes a required literal token. These follow from E2; the observed empty results are corpus-specific.
2. No stemming does not mean no normalization: the existing integration test expects `cafe` to match `café` (`test/sqlite.test.ts:79`, `:90`). Do not describe full-text as byte-exact or case-sensitive substring matching.
3. Selecting Porter cannot be promised to equate every related word or specifically to repair `reconcile` versus `reconciliation`. That pair has not been verified under Porter here. It is an explicit test case for an optional change, not an asserted benefit.

## Disposition And Contract Impact

| Item | Recommendation | Safe Specification Versus Owner Decision | Public Contract / ADR |
| --- | --- | --- | --- |
| P1: F3 + F4 | Clarify query semantics and use of `types`; preserve search behavior. | Safe to implement as specified once execution is authorized. | Description-only public surface change; no input/output/error shape change. New ADR and index row. |
| P2: F5 | Explain provider requirements, full-text recovery, stale discovery, and status limitations; add no status field. | Safe documentation/description fix. Owner may accept the recommendation not to add readiness. | Description-only surface change; current status shape/error codes remain unchanged. Share P1's ADR if shipped together. |
| P3: F1 | Add a native FTS lexical excerpt as a separate optional `fulltextExcerpt` string. Keep `matchedChunk` semantic. | **Owner decision required** on the additive output and bounded content disclosure. | Additive optional `objects_search` output field and additive SQLite API; own ADR/index row and vault contract changes. |
| P4: F2 | Keep current tokenizer now. If requested, offer explicit opt-in Porter with a fresh derived cache. | **Owner decision required** before any tokenizer/configuration work. No automatic default change. | Opt-in configuration and retrieval-semantics change, not a new tool input/output/error code. Own ADR/index row; query description must follow effective configuration. |
| P5: downstream closure | Update the recorded contracts, test traceability, docs, and agent skill in the slice that changes their meaning. | Required companion work, not optional polish; vault writes need separate authorization. | Contract objects are authoritative. No schema/data migration and no batch rewriting of the corpus. |

There are no new error codes in the recommended scope. An added status readiness field would be a separate public output change even though `StatusOutput` currently allows any JSON object (`src/lib/mcp.ts:152`). A permissive wire schema does not remove the obligation to decide and document the field's meaning.

## Architecture Alternatives And Decisions

### F1: Where To Compute An Excerpt

| Alternative | Exact Surface | Benefits | Cost / Failure Modes | Decision |
| --- | --- | --- | --- | --- |
| Native FTS excerpt from the matching indexed column | `FTSIndex` in `src/lib/sqlite/fts-index.ts`, then `LexicalMatch`/`SqliteIndex.search` in `src/lib/sqlite/index.ts` | Uses the same tokenizer/match instances as ranking; recognizes normalized tokens and any future stems; can show frontmatter-only matches. No new dependency or extra database query. | Native snippet text has no raw offsets; automatic column choice is not BM25 column-weight attribution. Token and character limits differ. Requires public representation decision. | **Recommended**, with a separate plain-text excerpt field. |
| Application window computed from the projected row | `SqliteIndex.lexical`, a new lexical-excerpt helper, and `SqliteIndex.search`; use existing `MetadataRow.{name,title,raw,body}` | No FTS wrapper API change. A raw slice can supply truthful raw code-point offsets and potentially reuse `matchedChunk` with index zero. | Simple `indexOf(query)` fails for AND, punctuation, diacritics, and stemming. Implementing equivalent token normalization/offset mapping duplicates SQLite behavior. Body-only windows miss frontmatter. Parsed name/title can differ from their escaped/folded YAML representation, so a label match need not have a simple raw substring. | Viable for a deliberately narrower/fallback contract, but rejected as the default because it increases maintenance or returns misleading evidence. |
| Native highlight plus an exact raw slice | Add `highlight` projection in `FTSIndex`; strip collision-safe markers and map to code points in `SqliteIndex` | Preserves SQLite token matching and raw offsets when the match is in `raw`; could reuse the existing chunk shape without fake positions. | Full-column processing, marker collisions, repeated spans, label-only matches, and raw-versus-parsed text need explicit handling. More machinery than a textual discovery excerpt needs. | Feasible alternative if the owner requires `matchedChunk` reuse; not the recommended slice. |
| Leave null and tell agents to `get` every hit | Documentation only | No new contract or code. | Preserves the client round trips that F1 identified. | Simpler fallback if output extension is declined. |

**Why not just fill `matchedChunk.text`?** Its index and offsets are not decoration. A snippet selected from `name`/`title` does not have raw-file coordinates, and a native snippet can contain inserted ellipses. Fabricating `{index: 0, start: 0, end: text.length}` would contradict E5. Reusing the existing shape is only cheaper if its meaning is silently weakened; this plan rejects that shortcut.

**Recommended column policy:** Request native automatic selection across all indexed columns, not body-only and not a hardcoded title priority. In `object_fts`, column zero is the unindexed key and the searchable columns are name/title/raw at ordinals 1/2/3 (E1 and `FTSIndex.initialize`, E12). Automatic selection can choose any matching name, title, or raw fragment. Do not claim the chosen column caused the largest BM25 contribution. A description/relation-id match that exists only in frontmatter must return the actual raw YAML fragment, including field context when it fits; never substitute the body introduction, invent prose, strip out the matched id, or hide the hit. For cross-column AND matches, one excerpt need not display every term.

**Feasibility checked without execution:** The installed SQLite implementation is readable locally at `node_modules/better-sqlite3/deps/sqlite3/sqlite3.c`. `fts5SnippetFunction` at line 245038 accepts the table plus five arguments, selects columns when the column argument is negative at 245087, bounds its token count to 64 at 245074, and returns text. `fts5HighlightFunction` at 244853 is the exact-match-marker alternative. Registration is at 245423. No download or extension installation is needed for this method. This establishes the implementation path in the installed dependency source, **not** that new SQL has passed on either configured driver. Both-driver tests below are a required implementation gate; no SQLite C source is to be edited or vendored.

**ADR rationale:** Reuse existing FTS5 rather than buy/add a search library or build another tokenizer. Keep retrieval synchronous inside the existing SQLite snapshot and provider work asynchronous outside it; do not add a queue, service, CQRS layer, or alternate storage. Relational derived tables already provide the required source/filter/ranking boundary. This is a bounded projection improvement, not an architecture replacement.

### F2: Stemming And Rebuild Policy

| Alternative | Benefit | Cost And Protection | Recommendation |
| --- | --- | --- | --- |
| Retain `unicode61 remove_diacritics 2` and document it | Keeps the measured deterministic ranking and existing caches working. | Agents still need exact token variants or another query. No rebuild. | **Ship this now.** |
| Opt-in Porter, default unchanged | Can improve recall for some word suffix variants without another dependency. | Different token groups can change scores/order and precision, including hybrid lexical contributions. Existing cache must not be reused under a different tokenizer. Use explicit config plus fresh cache and rollback. | Conditional P4 if the owner values the recall improvement. |
| Change the default to Porter on upgrade | No operator configuration for new stemming behavior. | Startup failure on old layouts, surprise ranking changes, and rebuild/re-embedding work for all deployments. | Reject for this work. |

If P4 is selected, use `porter unicode61 remove_diacritics 2`, preserving the current explicit diacritic mode rather than silently changing it too. This full literal is **not currently allowed** by `FTSIndexOptions` or its runtime allowlist: both must be extended. Native `fts5PorterCreate` in the local SQLite source at 266443 passes arguments following the base tokenizer to its creation function at 266473; this establishes the composition path, with both-driver regression tests still mandatory. Do not merely replace the hardcoded tokenizer with `porter unicode61` and assume every other behavior is unchanged.

**Rebuild cost:** A fresh whole-cache rebuild reads and validates all registered source files and rewrites metadata/FTS proportional to corpus content, then regenerates embeddings for every eligible document/chunk if a provider is enabled (`ObjectFramework.reconcile`, E12; embedding loop at `src/lib/framework.ts:375`). It also resets that cache's generation/history/count state. There is no measured seconds/MB estimate for this vault. Full-cache replacement loses cached vectors in the replacement cache, not object data. An FTS-only owned transactional rebuild could preserve vectors, but no such operator command exists in the inspected search path; adding one is not smuggled into this plan.

**Operator protection:** Default unchanged; publish the selected tokenizer in configuration docs and effective query guidance. Never auto-delete, silently rebuild on startup, or weaken the mismatch guard. Stop users of the old cache, keep the old cache and its WAL/SHM state intact, select a **new SQLite path outside the object root** and the new tokenizer explicitly, then start/sync that fresh cache. Validate counts/issues and agreed query fixtures before adopting it; restore old config/code/cache together for rollback. Do not copy a live SQLite file piecemeal or delete object files. For lexical-only validation, use an explicitly authorized disabled-provider configuration so rebuilding cannot request model assets; that does not validate semantic retrieval. `objects_resync` alone cannot repair a tokenizer mismatch that prevents startup. No existing Markdown object is migrated, rewritten, or versioned by this operation.

### F5: Why Not Add `ready` Now?

| Alternative | What It Establishes | Cost / Misleading Cases |
| --- | --- | --- |
| Existing status plus better guidance | Configuration identity, indexed embedding counts, known issues, sync state. | No guarantee of the next inference; this limitation is stated rather than concealed. |
| Report snapshot presence | Some local files exist. | ONNX-specific, ignores injected/remote providers, may miss corrupt files/external tensors/device failures, and would need filesystem work or cached state in the synchronous status path. Must not be called semantic readiness. |
| Probe with inference | One inference succeeded at a point in time. | Can load a large model, fail on device/authentication, send network traffic for a remote provider, or race subsequent changes. Incompatible with cheap read-only status expectations and this task's permissions. |
| Cached last embedding outcome | A previous attempt succeeded/failed/has not run. | Honest historical diagnostic, not present readiness. Requires a state machine for query versus document failures, cancellation, recovery, injected providers, timestamps, and typed output. |

**Recommendation:** No new status field in this batch. State that provider/fingerprint/dimensions and zero pending embeddings are **not readiness certificates**. Use an explicit `mode: "fulltext"` when availability is unknown; inspect known issues for diagnostics, not as an exhaustive current health proof. A missing local model and an unavailable remote provider retain their existing error contracts. If the owner wants historical outcome reporting, commission that as a separately approved contract rather than naming a boolean `ready` whose guarantee cannot be kept. No network/download remedy is executed by these fixes.

## Implementation Steps

All paths below are **future authorized changes**, not changes performed by this planning task. Effort is an engineering estimate for one repository-familiar implementer, not a delivery commitment. Docs/vault/skill companions in P5 are part of each slice's definition of done.

### Phase 1: Walking Skeleton, Truthful Full-Text Discovery

#### P1. Publish Lexical Semantics And Kind Filtering (F3, F4)

**Goal and observable change:** A `tools/list` response itself teaches the agent how to form a valid useful full-text query. Retrieval, ranking, tool count, schemas' structural validation, and errors remain unchanged.

**Exact surface:** `src/lib/mcp.ts`: `buildInputSchemas` annotations for `query` and `types`, plus the `objects_search` registration description in `registerObjectTools`. `test/mcp.test.ts`: the existing effective-bound/schema-advertisement case at line 242 and new semantic-description assertions. `test/sqlite.test.ts`: `literalFtsQuery` cases at line 466 and the both-driver literal Unicode test at line 79. No tokenizer/index-layout change.

**Proposed query description for the current configuration:**

> Full-text words are literal Unicode tokens, all required (AND), with no stemming. Quotes, `*`, and punctuation do not enable phrase or prefix search; AND/OR/NOT are ordinary required words, not operators. Searches name, title, and the complete raw Markdown file, including YAML frontmatter fields, descriptions, relation ids, and body. Type names and directory names are not added as searchable text; use `types` to restrict object kind.

**Proposed `types` description:**

> Restrict matching objects to these registered type names before ranking limits. Omit to search every type; an empty array searches none. A type name is a filter, not a word you need to put in `query`. Use the per-type list tool to enumerate a type without a content query.

Do not advertise raw FTS features or reject operator-looking strings that currently work as literal terms. Preserve E2's punctuation behavior. Keep this wording scoped to full-text, including the lexical component of hybrid; semantic queries remain natural-language provider input.

**Acceptance and verification:**

1. Given the default or custom-bound facade, when tools are listed, query/types descriptions state every semantic fact above while existing enum, topN/default, and 64-tool assertions still hold.
2. Given a controlled document containing both `alpha` and `beta` far apart, when querying `"alpha beta"`, it matches; `alpha OR absent` requires the literal OR/absent tokens; `reconcil*` encodes identically to `reconcil`. Add exact encoder assertions so documentation cannot imply blanket rejection.
3. Given a `scenario_acceptance_criteria` fixture whose content contains neither kind word, when querying `acceptance criteria` with that filter, no hit is expected; querying an actual fixture word with that filter finds it. This demonstrates filtering is not content injection.

**Focused command:** `bun test test/mcp.test.ts test/sqlite.test.ts`.

**Step gate:** `bun run check` then `bun run smoke:build`, plus P5 contract closure. All commands run from the repository root only after execution authorization.

**Dependencies:** None. **Effort/complexity:** 2-3 hours, small runtime change with test/docs companions. **Risk:** Low. Main failure is overclaiming phrase rejection, exact-string matching, or universal absence of type words; use encoder assertions and isolated fixtures rather than the changing live vault.

#### P2. Publish Availability And Freshness Guidance (F5)

**Goal and observable change:** Agents choose an explicitly available mode and do not treat search absence or a configured provider as proof. No behavioral/status-shape change.

**Exact surface:** `src/lib/mcp.ts`: `buildInputSchemas.mode`, `objects_search` and `objects_status` descriptions in `registerObjectTools`. `test/mcp.test.ts`: update the exact old mode-description assertion at line 266 and assert new availability/freshness/status clauses. `test/framework.test.ts`: preserve/extend provider-failure case at line 465, disabled-provider cases, and stale-hit omission coverage. `ObjectFramework.search`, `ObjectFramework.status`, `StatusOutput`, and provider code stay unchanged.

**Description contract:** State that semantic/hybrid require a working provider, with a prepared snapshot for the local ONNX provider; configuration alone does not guarantee readiness. Keep the exact current default rule. Advise `mode: "fulltext"` for embedding-free operation, including after `EMBEDDINGS_DISABLED` or `EMBEDDINGS_UNAVAILABLE`. State that synchronized search can miss recent/invalid/stale objects, `topN` is a maximum, known ids use `get`, and an absence claim needs a complete successful paginated source listing. `objects_resync` repairs derived state but is a write action, not an investigation prerequisite. Do not say `dirty: false` proves all source content is current or that status validates a model.

**Acceptance and verification:**

1. Given listed tools, the mode description retains configured-provider defaults and names explicit full-text recovery; the status description distinguishes configuration from usability; search warns about stale/missing results without requiring callers to run resync.
2. Given a deterministic failing injected provider, semantic/hybrid retain `EMBEDDINGS_UNAVAILABLE`; with no provider they retain `EMBEDDINGS_DISABLED`; explicit full-text succeeds in both conditions. Test both modes without real inference or network. Preserve the empty-`types` early return.
3. Given a changed/deleted candidate source, it is still omitted and reconciliation requested. Existing `matchedChunk` offsets, status fields, bounded issue counts, and source-authoritative `get`/list behavior remain unchanged.

**Focused command:** `bun test test/mcp.test.ts test/framework.test.ts`.

**Step gate:** `bun run check` then `bun run smoke:build`, plus P5 closure.

**Dependencies:** P1 for a single coherent description/ADR/skill edit. **Effort/complexity:** 2-3 hours, small. **Risk:** Low. Overlong descriptions can obscure defaults; put concise actionable guidance on tools and detailed diagnostics in docs. Tests must mock providers, not prepare a model. This completes the first end-to-end milestone without waiting for P3/P4 decisions.

### Phase 2: Bounded Lexical Evidence, Only After Owner Approval

#### P3a. Add An Opt-In Native Excerpt Projection (F1 Foundation)

**Goal and observable change:** The SQLite abstraction can return a lexical snippet in the same query, without changing existing search callers or ranking.

**Exact surface:** `src/lib/sqlite/fts-index.ts`: add `FTSExcerptRow<Row>` extending `FTSRow<Row>` with `readonly excerpt: string`; add `FTSIndex.searchRowsWithExcerpt(query, filter?, limit?)`. Share the validated MATCH/filter/ranking/projection implementation with `searchRows` through a narrowly typed private helper rather than copying SQL. Existing `FTSIndex.search`, `searchRows`, `FTSResult`, and `FTSRow` shapes remain unchanged. `src/lib/sqlite/public.ts`: export the new row type. `test/search-abstraction.test.ts`: both-driver search cases and ranking/source-name collision fixtures. `docs/database.md`: new method/result row next to the current table at line 193.

**SQL policy:** The new projection calls `snippet(<quoted FTS table>, -1, '', '', '...', 32)` in the same SELECT that evaluates MATCH/BM25. Use a separate reserved alias containing spaces, analogous to `SCORE_KEY`, and materialize it outside the source `row` namespace. Table names still pass `quoteIdentifier`; query and filters remain bound parameters; no user-controlled SQL/column arguments. The 32-token budget is internal and fixed, not a new configuration or tool input. It is distinct from the later public code-point cap.

**Acceptance and verification:**

1. Given matches only in each indexed column, including extractor-maintained columns, when using the new method, a nonempty snippet contains fixture match evidence. With a frontmatter-only relation id, it returns the raw YAML evidence. Automatic selection is allowed; tests must not force a body/title winner where multiple columns match.
2. Given identical inputs, the old and new methods return exactly equal identities, raw BM25 values, source fields, and order. Cover type filters, limits, duplicate terms, punctuation-only input, accents, and repeated matches. No extra source read or per-result SQL statement is introduced.
3. Given a source column named `excerpt` or a retained extra column resembling metadata, neither can shadow returned source/rank/excerpt metadata. Existing callers still receive their original shape without the excerpt. Both `better-sqlite3` and `bun` driver cases execute, not merely one selected driver.

**Focused command:** `bun test test/search-abstraction.test.ts test/cache-abstraction.test.ts`.

**Step gate:** `bun run check` then `bun run smoke:build`. Record the SQLite API addition in P3's ADR and vault before releasing the helper; the public MCP behavior remains unchanged until P3b.

**Dependencies:** Owner approval of P3; P1/P2 are the recommended prior milestone, not a technical SQL dependency. **Effort/complexity:** 3-4 hours, medium. **Risk:** Medium. New auxiliary SQL may behave differently under a custom SQLite build; the two-driver gate is decisive. Do not install another SQLite/dependency to get green. If unavailable, retain the description-only milestone and report the limitation rather than substitute invented offsets or silently remove excerpts.

#### P3b. Deliver Lexical Excerpts Through Search And MCP (F1 Walking Slice)

**Goal and observable change:** Full-text discovery returns why a result matched without requiring an agent `get` for each hit. The server's existing per-hit checksum reads remain; this is not a claim to eliminate all filesystem reads (E9).

**Exact surface:** `src/lib/sqlite/index.ts`: `LexicalMatch`, `SqliteIndex.lexical`, the combined entry's lexical metadata, and `SqliteIndex.search` hit projection. Call the new excerpt method; carry the text with the lexical score/rank. `src/lib/types.ts`: add `readonly fulltextExcerpt?: string | null` to `SearchHit`. `src/lib/mcp.ts`: add `Schema.optionalKey(Schema.NullOr(Schema.String))` to `SearchOutput` and document it on `objects_search`. Do not change `SearchRequest` or reinterpret `matchedChunk`. `test/sqlite.test.ts`, `test/framework.test.ts`, `test/mcp.test.ts`: projection, real-file/checksum, and protocol/schema assertions. `scripts/smoke-stdio.py`: in `run`, assert the returned lexical excerpt on its existing full-text hit.

**Output policy:**

| Hit | `fulltextExcerpt` From Concrete `SqliteIndex` | `matchedChunk` |
| --- | --- | --- |
| Full-text | Native excerpt, capped with `Array.from(text).slice(0, maxMatchCharacters).join("")` | Remains null |
| Hybrid with lexical contribution | Same lexical excerpt | Existing semantic chunk if there is a semantic contribution; otherwise null |
| Semantic-only hit, including one in hybrid | Null | Existing semantic chunk |

Make the new field optional in the public TypeScript/wire shape to preserve injected/custom facade producers that implement the old `SearchHit`; the concrete index always emits a string or null. Clients must accept absence from other implementations/older servers. The excerpt is plain text with native `...` omission markers, no HTML highlighting, no new column provenance, and **no coordinates**. It can contain frontmatter even with `includeBody: false`; complete bodies remain opt-in. It is bounded evidence, not a complete explanation of every AND term. A very small character cap or a very long token can clip the visible match, so do not promise every capped excerpt displays every query term.

**Acceptance and verification:**

1. Given body-only, name-only, title-only, description-only, and relation-id-only match fixtures, full-text results expose nonempty useful evidence with the default cap, omit `body` by default, and preserve `matchedChunk: null`. Use realistic YAML serialization plus an escaped/folded-name fixture so no raw-offset equivalence is assumed.
2. Given `maxMatchCharacters: 5`, long text and astral Unicode, the excerpt has at most five code points without splitting surrogate pairs. Given semantic/hybrid fixtures, semantic chunk indexes/offsets/text are unchanged; a lexical-only hybrid candidate gets lexical evidence even without vectors of its own. Existing rank, score, tie-break, type, topN, and generation results are identical on an unchanged fixture corpus.
3. Given MCP responses, the schema accepts both the new concrete field and its absence from a custom facade, enforces string/null when present, and the stdio source and bundle smoke both observe lexical evidence. Stale candidates are still discarded by checksum revalidation without refill. No change to known validation/error codes or tool count.

**Focused command:** `bun test test/sqlite.test.ts test/framework.test.ts test/mcp.test.ts test/library-boundary.test.ts`.

**Step gate:** `bun run check` then `bun run smoke:build`, plus the F1 rows of P5. Tests in the same development step must fail before the change and pass afterwards; do not land a test-only red state.

**Dependencies:** P3a and owner's output/disclosure approval. **Effort/complexity:** 4-6 hours, medium, split by projection/protocol versus contract companions if useful. **Risk:** Medium. A second excerpt field costs response tokens; at default cap/topN its text budget is at most 12,000 code points, before JSON/other fields. Preserve the cap for custom configurations too. Do not force a fake chunk index to avoid the new field. Optionality is deliberate compatibility, not a reason for the concrete implementation to omit evidence.

### Phase 3: Optional Stemming, Not On The Default Critical Path

#### P4. Add Explicit Tokenizer Selection And Rebuild Safeguards (F2)

**Goal and observable change:** Operators who approve recall/ranking changes can select stemming, while unchanged configurations keep the measured behavior. The better answer for the current batch is documentation only; this package is the ready conditional alternative, not an instruction to implement it by default.

**Exact surface:**

| File | Symbols / Change |
| --- | --- |
| `src/lib/types.ts` | `FrameworkConfig.search`: add `fulltextTokenizer` with only `"unicode61 remove_diacritics 2"` and `"porter unicode61 remove_diacritics 2"`. No object or `SearchRequest` fields. |
| `src/lib/config.ts` | `FrameworkConfigSchema.search`, `defaultConfig.search`: validate the two literals; default to the existing tokenizer. `FrameworkConfigInput.search` already derives from a partial search config. |
| `src/lib/sqlite/fts-index.ts` | `FTSIndexOptions.tokenizer` union and `FTSIndex.initialize` allowlist: allow the combined Porter/explicit-diacritic literal; retain every existing wrapper-supported literal and incompatibility check. |
| `src/lib/sqlite/cache-database.ts` | `CacheDatabase` constructor and `ObjectMetadataTable` constructor: thread an optional, typed tokenizer parameter with the old literal as default. Preserve direct cache-constructor callers and schema version/ownership guards. |
| `src/lib/sqlite/index.ts` | `SqliteIndex` constructor: pass the selected tokenizer to `CacheDatabase`. `validateConfig` should reject unknown runtime tokenizer values consistently with the lower layer. |
| `src/lib/mcp.ts` | `EffectiveSearch`, `buildInputSchemas`, `registerObjectTools` effective settings: describe the configured stemming policy, defaulting to current semantics when the facade exposes no configuration. Do not leave a hardcoded “no stemming” claim when Porter is configured. |
| Tests | `test/config.test.ts` for default/allowlist/invalid inputs; `test/sqlite.test.ts`'s `search` fixture and both-driver queries/reopen; `test/search-abstraction.test.ts` for the new literal and mismatch behavior; `test/cache-abstraction.test.ts` for old cache compatibility; `test/mcp.test.ts` for effective query descriptions. |

**Acceptance and verification:**

1. Given an old config/cache, behavior, rank/score on controlled queries, and reopening remain unchanged. Given a new cache with Porter selected, test a concrete suffix pair such as `connect`/`connected` and record the actual outcomes for `reconcile`, `reconciliation`, and `reconcil`. Do not alter tests to claim Porter equates a pair it does not equate. Prefix/operator behavior remains literal.
2. Given an existing unstemmed cache, opening it with Porter fails without changing source files or silently substituting a tokenizer; reopening with the original configuration still works. Given a fresh path and the same source documents, rebuilding produces equivalent object identities/counts/checksums and useful full-text results. If P3 shipped, excerpts reflect stemmed matches through the native tokenizer rather than a JavaScript substring guess.
3. Given invalid tokenizer configuration, strict validation rejects it. Tools listed under the two valid configurations describe the effective stemming policy. Both-driver Unicode/diacritic, filter, and persistence tests pass. The operator instructions explicitly identify re-embedding cost, opt-in, rollback, and no object migration.

**Focused command:** `bun test test/config.test.ts test/search-abstraction.test.ts test/cache-abstraction.test.ts test/sqlite.test.ts test/mcp.test.ts`.

**Step gate:** `bun run check` then `bun run smoke:build`, plus P5's conditional F2 closure. Native/model-backed performance is not claimed by these commands.

**Dependencies:** Explicit P4 approval; P1/P2 wording must be revised with the effective-setting clause. P3 is not a technical prerequisite; when P3 has shipped, extend its native-excerpt regression coverage to Porter rather than adding a separate token-matching algorithm. **Effort/complexity:** 1-2 engineering days including compatibility fixtures and operator docs. **Risk:** High relative to this batch: recall/precision trade-offs, score changes, startup incompatibility, accidental whole-cache vector loss, or an English-oriented suffix policy being mistaken for general semantic matching. Do not activate it on the live vault as part of ordinary tests or release automatically.

### P5. Contract, Documentation, Vault, And Agent-Skill Closure

**Goal and observable change:** The running surface, written contracts, and project knowledge describe the same delivered behavior. Complete the applicable rows below within each slice, not as an unscheduled follow-up.

| Slice | Versioned Documentation / ADR / Skill Change | Vault Obligations Under `.local/.structree/objects` |
| --- | --- | --- |
| P1 + P2 | New `docs/decisions/0008-search-query-and-availability-guidance.md` and row in `docs/decisions/README.md`; update `docs/core-schemas.md` “The tool surface”, `docs/library.md` “The facade contract”, `docs/database.md` literal-query section, `docs/embeddings.md` local-provider availability note, and `README.md` search/status explanations. Update `.opencode/skills/structree/SKILL.md` “Find before you list”, “Check the state”, failure modes; update `references/tool-reference.md` search parameters/results/status. No need to alter the core relationship model or `references/object-model.md`. | Revise interfaces `mcp-objects-search`, `search-api`, `mcp-objects-status`, `agent-skill-structree`; extend contract `search-bounds-enforced` for existing provider failure semantics without recasting all query semantics as bounds. Add the proposed contract `fulltext-query-semantics` for this distinct guarantee; relate its interfaces with `usedBy`, `dependsOn`, and new ADR `commitsTo` links in their proper directions. Refine `mcp-objects-status`'s current “sync readiness” wording so it does not imply provider readiness. Extend existing scenario/test evidence for `full-text-bm25-ranking` and `embedding-provider-failures`. |
| P3a + P3b | New `docs/decisions/0009-fulltext-search-excerpts.md` and index row; update `docs/database.md` method/result table, `docs/library.md` hit contract, `docs/core-schemas.md` public search output, `docs/embeddings.md` distinction from semantic chunk offsets, `README.md` result explanation. Skill and tool-reference explicitly distinguish `fulltextExcerpt` from nullable semantic `matchedChunk`, frontmatter content, cap, and old-server/custom-facade absence. | Revise entities `search-hit`, `full-text-row`; interfaces `sqlite-index-api`, `search-api`, `mcp-objects-search`, `agent-skill-structree`. Preserve contract `search-hits-revalidated`; add proposed `fulltext-excerpt` contract with the chosen optional field, evidence bounds, no-offset semantics, and source revalidation. Link the new ADR to `full-text-bm25-ranking`; add criteria/test commitments for body, frontmatter, Unicode bounds, unchanged ranking, and protocol compatibility. |
| P4, only if selected | New next-numbered `docs/decisions/0010-opt-in-fulltext-stemming.md` and index row (use 0009 if P3 did not happen); update `docs/configuration.md` search settings, `docs/database.md` tokenizer/rebuild compatibility, `docs/library.md`, `docs/core-schemas.md`, `README.md` search semantics, skill query guidance/tool reference, and any F1 excerpt description affected by the changed tokenizer. Never mark the old general search ADR accepted by implication. | Update `fulltext-query-semantics`, `index-rebuildable`, `search-api`, `mcp-objects-search`, `sqlite-index-api`, and relevant configuration interfaces/test evidence. Record explicit tokenizer/rebuild choice in a new ADR object linked to `full-text-bm25-ranking` and `cache-ownership-and-schema-version`; retain existing ADR history. Add opt-in/reopen/rebuild criteria and tests, not a requirement to migrate all objects. |

ADR numbers above are proposed next slots, not files created by this plan. Allocate the next available number at execution if another authorized change used a slot. Description-only public changes still receive the decision record required by the task; full public input/output/error shape changes must never be hidden in that descriptive ADR. If P3 is accepted while writing 0008, either keep the records separate as above or explicitly identify its independently approved output decision.

Proposed matching vault ADR ids are `adr-search-query-and-availability-guidance`, `adr-fulltext-search-excerpts`, and, only for P4, `adr-opt-in-fulltext-stemming`. For F1, proposed new criterion ids are `fulltext-excerpt-shows-match-evidence`, `fulltext-excerpt-is-bounded`, and `fulltext-excerpts-preserve-ranking-and-semantic-offsets`, owned by the existing `full-text-bm25-ranking` scenario. Check for existing equivalents before creating them and reuse a matching object rather than duplicate it. Record new test commitments only after the corresponding executable assertions exist.

**Existing vault anchors verified during planning:**

| Object | Exact Existing Path Relative To `.local/.structree/objects` |
| --- | --- |
| `contract/search-bounds-enforced` | `contracts/id-25b028d79593fb6aa1da8677396f58fe5c33b64a6faa82b53ef7ba781c12a887.md` |
| `contract/search-hits-revalidated` | `contracts/id-45a447a9717c2b255148ce1dc120c712cf1683768fd5fbd3423dd815311bcc21.md` |
| `contract/index-rebuildable` | `contracts/id-e0ed4cf5186bad28097d90eb07893ef84ce4b454868f72f80bd480a9851e0f11.md` |
| `interface/mcp-objects-search` | `interfaces/id-e648fb7313cb9517754466ad855bae5388f872557d4ae7e919098670e72456b4.md` |
| `interface/search-api` | `interfaces/id-a74351c5cb312407f42aafac5fb7391607e51db2fac27dc6647e7cd4a0c9a90a.md` |
| `interface/sqlite-index-api` | `interfaces/id-e20cd11aa09c6d013a9808b8f7d132d5a319247d64b365750126dd3c86a07b70.md` |
| `interface/mcp-objects-status` | `interfaces/id-7f5aa9dbd45e50a0f7e3fc7f103f317b024dcc957462d6a0c9bc2188de29970b.md` |
| `interface/agent-skill-structree` | `interfaces/id-424677db6f0e366f40aa7fd19fa87402e590e968d3434a2174347fd90f20b3de.md` |
| `entity/search-hit` | `entities/id-8595eab9d28836b414d0d832c7bfeb9df2a9d38ecc35ee5c8eb88a8098c4f67d.md` |
| `entity/full-text-row` | `entities/id-cae79dfc7df2190fcdd297e87157a6323261c6abb9cd0ed0fb54d3f0ba42943e.md` |

These objects were located/read through the allowed read-only tools/files; they are not implementation evidence for future changes. Some existing vault bodies cite older source lines. Refresh touched objects' evidence to current symbols/lines and actual test names/results, not the old line references copied from a `get` response. Existing suite objects located locally include `mcp-test`, `framework-test`, `sqlite-test`, `search-abstraction-test`, `cache-abstraction-test`, and `config-test`; extend their records for tests actually added. New proposed contract/criterion/test ids above are not assertions that those objects already exist.

**Vault update procedure for the later authorized executor:** Read the relevant definitions and latest object revision first; preserve ids and `createdAt`, set an actual later `updatedAt`, preserve unrelated fields and existing relations, and submit the complete object/body with the latest `expectedChecksum`. Confirm target ids before adding relations: they are not foreign-key validated. Represent accepted ADRs, criteria, interfaces/entities, and tests in their appropriate types; follow `ADR.commitment.scenarios`, `contract/interface/entity.commitsTo`, `acceptance_test.commitsTo` criteria, `scenario_test.commitsTo` interfaces, and `unit_test.commitsTo` entities. Do not invent a test result or blanket-create duplicate test objects. These are selective knowledge-authoring updates, **not object data migration**. The vault remains unversioned; a clean git diff alone cannot prove it was updated. Do not stage it or force-add ignored files.

**P5 acceptance and verification:** Every accepted guarantee has a matching recorded contract, correct relation targets, and test evidence; rejected/deferred choices remain explicitly deferred. The skill has no unconditional promise of a lexical `matchedChunk`, stemming, readiness, or exhaustive search. Newly added ADR frontmatter uses multiline block sequences for nonempty lists. Use `bun run check` and `bun run smoke:build` for each delivered slice, plus a content review using `git diff --check` and `git diff -- <that slice's authorized paths>`. After authorized vault updates, per-type `get` calls on every touched/new id verify final bodies/relations/checksums; these are additional evidence because the normal check gate does not prove semantic vault/doc consistency. No new automated vault migration/check script is required.

**Dependencies:** Each slice's approved behavior and tests. **Effort/complexity:** 2-4 hours for P1/P2 closure, 2-4 hours for P3, 2-4 hours for P4, depending on traceability additions. **Risk:** Medium documentation drift and false completion claims. Do not release an updated public surface while contract updates are blocked; report the exact missing vault/skill authorization instead of treating it as optional.

## Testing Strategy And Evidence Contract

| Claim | Owner / Smallest Evidence Path | Important Limits |
| --- | --- | --- |
| Query guidance equals implementation | Implementer: exact encoder assertions and MCP advertised-description checks in P1/P2. | Docs alone do not change recall; no claim that the observed empty phrase query is inherently invalid. |
| Lexical excerpts work with actual matching/normalization | SQLite implementer: both native drivers in `test/search-abstraction.test.ts` and `test/sqlite.test.ts`. | Static native-source inspection during planning is feasibility evidence, not a passed integration test. |
| Rank and identity are unchanged | SQLite implementer: compare old/new projection results over the same controlled corpus within a test, including ties/filters. | Never compare historical scores against an edited live vault and attribute every difference to code. |
| Public output and body behavior are compatible | MCP implementer: custom facade and real framework cases; source and built stdio smoke. | Optional field on custom facades is intentional; a client still needs to read the actual advertised schema. |
| Availability/freshness remain truthful | Framework implementer: deterministic failing/disabled provider and changed-source cases. | Mocked inference proves error handling, not actual model readiness. No silent fallback. |
| Opt-in tokenizer preserves defaults and fails safely on mismatch | P4 implementer: old-cache/new-cache and rollback-compatible reopen fixtures with both drivers. | No live-vault rebuild, model preparation, throughput assertion, or unverified morphological promise. |
| Tool/docs/vault/skill alignment | Slice owner: diff/content review and per-object checksum-guarded readback, plus matching new ADR/index row. | Gates do not substitute for this review; ignored vault data will not appear in ordinary git status. |

For every implementation step, first add the regression in the same slice and observe its meaningful failure, then implement and record passing results. Use `tmpdir()`/`mkdtemp` or the repository's fixture helpers for new scratch vaults/caches and clean up resources. Do not use the repository vault, fixed scratch paths, real embedding endpoints, or a model download. Leave opt-in ONNX environment variables unset for ordinary checks. Existing test scaffolds already parameterize both drivers (`test/sqlite.test.ts:77`, `test/search-abstraction.test.ts:198`); extend them rather than inventing a new runner.

Record the command, working directory, revision/diff, selected tests, exit status, fixture/config/provider mode, and any skipped/blocked gate with its reason. A passing typecheck alone does not establish search behavior. A focused command can be used for TDD; each completed delivery still runs the required full gates. Never claim the planning session ran any of them.

## Risks And Mitigations

| Risk | Likelihood / Impact | Mitigation |
| --- | --- | --- |
| Fake chunk offsets or wrong excerpt provenance | High impact if the existing chunk shape is reused casually. | Separate textual lexical evidence from semantic chunk coordinates; no made-up index/offsets. |
| Native excerpt differs by SQLite build | Medium / medium. | Local-source feasibility check plus actual both-driver integration gate; no dependency/install escape hatch. |
| Native snippet does not show every required term | Expected for distant/cross-column terms; low impact if documented. | Treat it as bounded discovery evidence, not a complete match trace. Test useful ordinary cases and small-cap clipping separately. |
| Excerpt exposes frontmatter/body without `includeBody` | Certain after P3 / medium. | Explicit owner approval and clear docs; no HTML interpretation; bounded plain text; preserve existing access boundary. |
| Added projection changes BM25/order/filtering | Low / high. | Same SQL MATCH/weights/order/limits, old/new result equality tests, unchanged corpus, and snapshot/generation assertions. |
| Stemming changes precision/ranking or misses the motivating word pair | Medium / high. | Default unchanged, explicit opt-in and fixture evaluation; no promise that all related words stem together. |
| Rebuild accidentally destroys object data or cached vectors | Low / high. | Fresh cache path outside source root, no automatic deletion/migration, stop shared users, retain rollback state, explain full-cache re-embedding. |
| A status `ready` flag lies | High if inferred from provider config / high. | Do not add it; document historical/configured/indexed state separately from successful future inference. |
| Tool text outruns bundle, vault, or skill | Medium / high. | Same-slice P5 closure, bundle smoke, and authorized host rebuild/reconnect instructions. No OpenCode configuration mutation is required. |
| Gates accidentally use real inference/network | Low / high. | Mock/disabled providers and isolated smoke config; never run model preparation or opt-in inference tests as part of this batch. |

## Success Criteria

The owner can approve the safe description milestone independently of the excerpt and tokenizer choices. P1/P2 have no search-result, status-result, input-shape, or error-code changes; the changed descriptions accurately explain the existing behavior. If P3 is approved, default-cap lexical hits in the specified fixtures supply meaningful bounded text without changing scores or semantic coordinates, and custom facade compatibility is demonstrated. If P4 is approved, old deployments remain unchanged and tokenizer mismatch never causes a silent rebuild or object rewrite. Every delivered public slice includes its ADR/index row, actual verification evidence, authoritative vault updates, and matching agent guidance.

## Recommended Sequence And Gates

```text
P1: query/kind guidance + tests + applicable P5 closure
  -> P2: provider/freshness/status guidance + tests + applicable P5 closure
       -> M1: truthful full-text discovery, default ranking unchanged

Owner approves excerpt output/disclosure
  -> P3a: opt-in native snippet method + both-driver tests + SQLite contract closure
       -> P3b: index/MCP/stdio lexical evidence + full F1 contract closure
            -> M2: useful lexical discovery evidence

Owner explicitly requests stemming
  -> P4: opt-in setting + fresh-cache compatibility + effective descriptions + F2 closure
       -> M3: opt-in stemming available; no automatic live-vault activation
```

**Critical path for the recommended release:** P1 -> P2 -> P3a -> P3b, with owner approval before P3 and contract closure at every milestone. P4 is not a prerequisite and should not block the cheap fixes or excerpts. P5 is a companion to each item, not a final catch-all phase. Sequence shared `mcp.ts`, docs, and skill edits; avoid parallel writers on them. Independent test fixture preparation or ADR drafting can be parallelized after the relevant decision, with one slice owner reconciling the result.

| Completed Step | Focused Verification | Required Green Gate Before Proceeding |
| --- | --- | --- |
| P1 | `bun test test/mcp.test.ts test/sqlite.test.ts` | `bun run check`, then `bun run smoke:build`, then P5 readback/review |
| P2 | `bun test test/mcp.test.ts test/framework.test.ts` | `bun run check`, then `bun run smoke:build`, then P5 readback/review |
| P3a, approved only | `bun test test/search-abstraction.test.ts test/cache-abstraction.test.ts` | `bun run check`, then `bun run smoke:build`, then P5 SQLite contract review |
| P3b, approved only | `bun test test/sqlite.test.ts test/framework.test.ts test/mcp.test.ts test/library-boundary.test.ts` | `bun run check`, then `bun run smoke:build`, then P5 full F1 readback/review |
| P4, separately requested only | `bun test test/config.test.ts test/search-abstraction.test.ts test/cache-abstraction.test.ts test/sqlite.test.ts test/mcp.test.ts` | `bun run check`, then `bun run smoke:build`, then P5 F2 readback/review |

All are proposed commands from `/home/projector/projects/opencode-structree`; none was run while planning. Approval to execute these repository checks does not authorize production model downloads, browser tooling, real OpenCode tests, live-vault rebuilds, or configuration mutation.

## Owner Decisions And Questions, In One Place

| Decision | Question | Recommended Answer / Consequence |
| --- | --- | --- |
| D1: F1 representation | Approve optional `fulltextExcerpt: string \| null`, with the concrete index always returning it, rather than overloading the coordinate-bearing `matchedChunk`? Approve automatic name/title/raw column choice and bounded frontmatter/body disclosure even when `includeBody` is false? | **Yes.** Proceed with P3a/P3b and their separate ADR/contracts. If not, ship P1/P2 only; a raw-coordinate reuse requirement must explicitly choose the more complex highlight/raw-slice alternative rather than invent positions. |
| D2: F2 recall versus stability | Keep the current tokenizer, or commission explicit opt-in Porter and fresh-cache rebuilding? Is the cost of changed rankings, possible precision loss, and potential re-embedding justified for this deployment? | **Keep current behavior now.** Documentation addresses the immediate misuse without destabilizing good ranking. If opting in, select P4 as specified; no default switch, no automatic rebuild, no guarantee about the `reconcile`/`reconciliation` pair. |
| D3: F5 readiness | Accept documentation of current status limits instead of another field, or require a separately specified historical provider-outcome surface? | **No readiness field in this batch.** Snapshot presence/configuration is not inference readiness. Historical outcomes need an explicit separate output/state contract; probes/downloads are out of scope. |
| D4: execution and knowledge authorization | Authorize the selected implementation slices, repository gates, related ADR/docs/skill edits, and checksum-guarded vault updates as one coherent scope? | Authorize only the selected slices. This planning task authorizes **only this new file**. The live-vault tokenizer rebuild/config activation, if ever wanted, requires a separate operational approval. |
| D5: delivery constraints | Are there a fixed deadline, implementation budget, external consumers, compliance/disclosure restrictions, or unavailable native test dependencies that would change these priorities? | None has been supplied; estimates are not commitments. If there is a constraint, choose P1/P2 as the smallest complete milestone and resolve D1's content disclosure before P3. No new technology or operational topology is selected on an assumed budget. |

## Runtime Feasibility Evidence

The excerpt and tokenizer feasibility above rested on static inspection of the installed SQLite source. A runtime probe was run afterwards against the installed SQLite in both drivers, using this repository's exact layout: a source table `object_meta(object_key, object_type, name, title, raw, body)`, an FTS table `object_fts` declared as `fts5(object_key UNINDEXED, name, title, raw, tokenize = '...')`, and the same insert, delete and update triggers as `src/lib/sqlite/fts-index.ts`. The results were identical under `better-sqlite3` and `bun:sqlite`, so driver parity holds for these facts.

| Question | Measured result | Consequence |
| --- | --- | --- |
| Does `snippet()` work against this trigger-maintained FTS5 table? | Yes, in both drivers. The statement that evaluates `MATCH` and `bm25(object_fts, 0.0, 3, 5, 1)` can also select `snippet(object_fts, -1, '', '', '...', 32)` and the column-specific forms `snippet(object_fts, 1\|2\|3, ...)`, where 1 is `name`, 2 is `title` and 3 is `raw`. | P3a's approach is feasible. A test still has to prove the projection in both drivers and the equality of the old and new result sets. |
| Which column does automatic selection choose? | `raw` in every case, because the raw document contains the name, the title and the body. A match that exists only in the YAML frontmatter, a relation id, returned the raw YAML fragment containing that id. | The excerpt shows the same document the match came from, not the body introduction. It is not a body-only window, and a caller must not expect a short window: the 32-token budget returned a short document whole. |
| Is `porter unicode61 remove_diacritics 2` a valid tokenizer literal? | Yes, in both drivers, and the stored schema shows it verbatim. The wrapper's `FTSIndexOptions.tokenizer` union and its runtime allowlist admit only `unicode61 remove_diacritics 2`, `porter unicode61` and `unicode61`. | P4's code change is exactly the two places this plan names. The literal itself needs no SQLite change. |
| Does Porter fix the motivating pair? | No. Under Porter, `connect` and `connected` both match, and `run` and `running` both match, but `reconcile` still does not match `reconciliation`, and `reconcil` matches nothing. Diacritic folding still works. | The recall gain is real for some inflection pairs and absent for the pair that motivated the question. Any statement about Porter must name a pair it actually equates. |
| What are the real query semantics? | Two words are an AND of tokens; `alpha OR absent` matched nothing because `OR` is a literal required token; `reconcil*` matched nothing because the asterisk is stripped and leaves the token `reconcil`; `"alpha beta"` behaved exactly like `alpha beta`, the quotes being stripped rather than making a phrase; a punctuation-only query encodes to no tokens and returns no matches instead of an error; more than 128 distinct tokens is rejected by the encoder; `cafe` matches `café`, so matching is not byte-exact and not case-sensitive. | The wording proposed in P1 is true as written, provided it says AND rather than phrase, names the 128-token limit and the punctuation-only case, and does not claim byte-exact or case-sensitive matching. |

The probe was run in a temporary directory outside the repository and outside the vault, and cleaned up. It wrote no repository file, no vault object and no model snapshot, and it is not evidence of any repository gate.

## Open Questions Answered

An independent advisory review answered D1 to D5 and T1 to T5 against the plan, the implementation and the runtime evidence above. The reviewer performed no writes, experiments, builds, network calls or model preparation; the runtime evidence was supplied to it. Its answers are recommendations, not approvals. **Protected** means an explicit owner decision is required, because the choice affects a public contract, a disclosure, operational state, or authorization; reversible code does not make those decisions unprotected.

**Recommended direction:** deliver P1 and P2 with their P5 closure first; deliver P3a and P3b only after an explicit output and disclosure approval; defer P4; add no readiness field.

### D1: the excerpt representation

Approve the separate optional field and automatic column selection, **provided the owner explicitly accepts the disclosure described below**. Keep `matchedChunk` exclusively semantic.

The concrete index should emit a string for full-text hits and for hybrid hits with a lexical contribution, and `null` for semantic-only hits. The public TypeScript and MCP schemas should allow absence, so older and custom producers remain valid. The excerpt is plain text, without coordinates, bounded by the native token budget and the configured code-point cap.

**Correction to this plan's P3b wording.** "Complete bodies remain opt-in" is true of the `body` field only. The runtime evidence shows that a sufficiently short document can be returned whole as an excerpt, and that neighboring frontmatter or body content can appear in a bounded excerpt. The character cap is a size bound, not redaction. If the owner requires that no body or frontmatter content appears unless it is opted into, the policy proposed here does not satisfy that requirement, and P3 needs a separately specified opt-in or redaction design rather than a claim that `includeBody: false` already enforces it.

**Consequence:** retain the P3a and P3b representation, clarify the disclosure wording and the short-document tests, and complete the applicable P5 contracts, decision record, documentation and skill. P1 and P2 remain independently deliverable if the disclosure is declined.

**Protected:** public output and disclosure. Disclosed content cannot be recalled, and a published field cannot later be removed without a compatibility consideration.

### D2: recall versus stability

Retain `unicode61 remove_diacritics 2` and defer P4.

The runtime evidence materially weakens the immediate case for Porter. It improves `connect`/`connected` and `run`/`running`, but it does not repair `reconcile` versus `reconciliation`. Any further recall gain would need an independently valuable use case, not the motivating pair alone.

**Consequence:** P1, P2 and P3 proceed without changing retrieval semantics or rebuilding a cache. P5 should replace this plan's "unverified pair" qualification with the measured negative result. P4 stays available as an explicitly commissioned option with unchanged defaults, fresh-cache validation, rollback and a documented re-embedding cost.

**Protected:** selecting another tokenizer and rebuilding are configuration and operational choices. Retaining the current tokenizer is reversible and touches no data.

### D3: readiness

Document the limits and add no status field in this batch.

Neither the configured provider identity, nor the presence of a snapshot, nor zero pending embeddings establishes that the next query embedding will succeed. A historical outcome surface could be useful, but it needs its own meaning, lifecycle and output contract.

**Consequence:** implement P2's descriptions and its deterministic failing and disabled provider tests, and correct the recorded status wording in P5, because the authoritative status record currently uses the ambiguous phrase "sync readiness". Keep the explicit full-text recovery and the current error codes. A historical outcome surface is a separate future slice, not an addition hidden inside P2.

**Protected:** a new diagnostic state machine or a public field would need separate approval.

### D4: execution and knowledge authorization

Authorize **P1 plus P2 and their P5 obligations as the first complete delivery**, followed by a separately approved **P3a plus P3b and their P5 obligations**. Exclude P4 unless expressly selected.

Each authorized delivery should carry its implementation, regression tests, required gates, a new decision record and index entry, the affected documentation, the project skill and tool reference, and selective checksum-guarded vault updates. Knowledge closure is part of the delivery, not optional follow-up.

Authorization should separately exclude live-cache activation and rebuilding, configuration mutation, model preparation, network activity and source-object migration unless expressly granted.

**Protected:** the authorization boundary itself. This plan grants none of those permissions.

### D5: delivery constraints

Treat these as unknown owner inputs, not as absent constraints.

Retain P1 and P2 as the provisional smallest complete milestone, and resolve disclosure and consumer constraints before P3. The probe establishes that both installed SQLite drivers can run the probed operations; it does not establish that every repository gate or deployment environment is ready. A missing gate dependency is a reported blocker, not permission to skip a driver or weaken a gate.

**Protected:** budget, consumer, disclosure-policy and acceptable-verification commitments.

### T1: native excerpt feasibility and the tests it still needs

Yes: the runtime evidence settles native feasibility for both installed drivers. Retain the same-statement projection; do not replace it with application-side token matching.

The implementation must still prove that the new wrapper method, not merely equivalent standalone SQL, works under both driver loops; that the old and new methods return identical source fields, identities, raw scores, filtering, limits and ordering on the same corpus while old callers keep their old result shape; that trigger maintenance produces current excerpts after insert, update and delete; that name-only, title-only, body-only and frontmatter-only fixtures expose useful evidence; that a source column cannot shadow the score or excerpt metadata; and that P3b propagates excerpts through fusion, the code-point cap, the MCP schemas, custom facades, checksum rejection and the source and bundle smoke.

Failure criteria: an auxiliary-function or SQL-context error, missing evidence on ordinary fixtures, stale text after an update, an alias collision, changed rankings or shapes, a broken Unicode cap, stale-hit leakage, or failure on either driver. A small cap clipping the visible match is an acknowledged limitation rather than a defect.

**Consequence:** P3a's feasibility uncertainty is closed; its integration gate and P3b's end-to-end tests remain mandatory. Record the probe evidence separately from the future passing implementation tests.

### T2: the combined tokenizer literal and the required changes

The literal is valid in both drivers, and the wrapper rejects it. Extend support only if P4 is approved.

Two scopes must not be confused. **Wrapper support** means adding the combined literal to the `FTSIndexOptions.tokenizer` union and to the runtime allowlist in `FTSIndex.initialize`, keeping every existing literal and every mismatch check; no SQLite change, extension or dependency upgrade is involved. **Operator-selectable P4** additionally threads a configured value through `FrameworkConfig.search`, the configuration schema and defaults, the `SqliteIndex`, `CacheDatabase` and `ObjectMetadataTable` constructors, direct index validation and the effective MCP descriptions, with the existing tokenizer remaining the default.

Tests must prove wrapper acceptance on both drivers, rejection of an invalid value, unchanged reopening of a default cache, refusal on a mismatch followed by a successful reopen with the original configuration, fresh-cache rebuild equivalence, Unicode folding, and both the positive and the negative stemming cases measured above.

**Consequence:** P4's native-literal uncertainty is closed, and P3a needs no tokenizer extension.

### T3: the excerpt column and frontmatter-only matches

Retain SQLite's automatic selection. For a frontmatter-only match, return the actual raw YAML fragment, keeping the matching value and nearby field context when they fit.

Do not substitute an unrelated body introduction, synthesize prose, strip the matching relation id, or impose a title-first policy. Automatic selection returned the `raw` column in every supplied fixture, but that is not a universal raw-only guarantee: the decoded name and title can differ from their raw YAML form, so automatic selection stays valid across the indexed columns. The excerpt is not a report of which column contributed most to the score, and one excerpt need not display every required term.

**Consequence:** retain P3a's automatic policy, let P3b add the code-point cap, and let P5 describe possible frontmatter and whole-short-document content.

### T4: the exact query semantics

The plan's core description is correct for the current lexical configuration, with normalization and limit qualifications added.

Recommended wording:

> Full-text search extracts Unicode letter, number and mark tokens and requires all of them (AND). Matching uses SQLite Unicode normalization, including case and diacritic folding, with no stemming in the current configuration. Punctuation separates or surrounds tokens; quotes and `*` do not enable phrase or prefix search. AND, OR and NOT are ordinary required words, not operators. The lexical encoder accepts at most 128 distinct extracted tokens, counted before SQLite normalization; exceeding that limit fails rather than truncating. A nonblank query containing only punctuation produces no full-text matches.

Further qualifications: two words mean both words anywhere, not a phrase and not an inherently invalid query; `reconcil*` searches `reconcil`, so it need not fail in every corpus; repeated identical tokens do not consume additional distinct-token slots, while case variants can count separately before SQLite folds them; blank or whitespace-only input is rejected separately by the framework; and these rules govern lexical evaluation, including the lexical component of hybrid, not the semantic provider input, which can fail before any lexical evaluation happens.

One correction to the plan's expectations: exceeding the 128-token limit must not be described as a `VALIDATION` error. The encoder throws an ordinary error, and the framework maps that path to `INTERNAL`.

**Consequence:** refine P1's descriptions and its exact encoder tests, preserve P2's provider guidance, and replace a hardcoded "no stemming" with effective-configuration wording if P4 is selected. Tokenization, limits and errors are existing behavior and must not change incidentally.

### T5: disclosure, body opt-in, revalidation and the hit shape

Preserve the separate excerpt field, but make approval conditional on an explicit distinction between field inclusion and content disclosure. Preserve checksum revalidation unchanged.

The search path gates only the `body` property on `includeBody` and already returns the semantic chunk text independently of it. The framework rereads each candidate source, keeps only checksum-equal hits, requests reconciliation for rejected candidates, and does not refill them. That revalidation protects the correspondence between a returned hit and its source at the check; it is not a confidentiality guarantee, not exhaustive discovery, and not immunity to later edits. The excerpt should travel with the indexed hit and be discarded with it when the checksum check fails. It requires no additional per-hit read, and it does not remove the existing reads.

**Consequence:** P3b's tests must cover an omitted `body` with a present excerpt, short-document disclosure, semantic shape preservation, and rejection of the whole hit after a source change. P5 must clarify the authoritative body guarantee and record the excerpt disclosure explicitly.

### Decisions that remain the owner's

These were the five open questions as this plan was written. They were subsequently answered rather than left open: see "Decisions Closed" below for the single answer given for each, the consequences accepted, and the trigger that would reopen it. What remains is the authorization act, not the substance.

## Decisions Closed

An advisory review was asked to answer the open questions rather than to recommend options. Each question below is closed with a single answer, the rationale that survives a challenge, the consequences that are being accepted, and the observable trigger that would reopen it. One execution approval covers the selected scope; no second design approval is needed between milestones. The review performed no writes, experiments, builds, network calls or model preparation.

### D1: add a separate lexical excerpt

**Decision.** Add an optional `fulltextExcerpt: string | null`, always emitted by the concrete index, using automatic native column selection, and permit bounded source-content disclosure independently of `includeBody`.

**Rationale.** The measured probe establishes that native excerpts work in both drivers without another query. `matchedChunk` and `SqliteIndex.matchExcerpt` give the semantic chunk real coordinates that a native excerpt cannot preserve, so a separate optional field keeps both meanings intact and still supports existing facade producers that omit it.

**Consequences accepted.** Responses grow. An excerpt can reveal neighbouring frontmatter and body content, and an entire short document. It carries neither coordinates nor a complete match explanation. `includeBody` governs the `body` property, not whether any document content appears elsewhere.

**Reopen when** a documented deployment policy prohibits automatic disclosure of source content while `includeBody` is false.

### D2: retain the current tokenizer

**Decision.** Retain `unicode61 remove_diacritics 2` and exclude P4 from this delivery in full, including the wrapper allowlist extension.

**Rationale.** The measured Porter results do not repair `reconcile` versus `reconciliation`, and its other suffix gains do not justify adding configuration, compatibility handling and rebuild obligations to solve the present usability problem. `FTSIndex.initialize` already protects existing caches against a tokenizer change.

**Consequences accepted.** Some morphological variants remain unmatched, so a caller must use the stored variant or another query. There is no tokenizer setting, no cache rebuild, no re-embedding work and no incidental ranking change.

**Reopen when** a repeatable acceptance test for a real retrieval task fails under the current tokenizer, passes under Porter, and passes that task's required precision fixtures.

### D3: document the status limits

**Decision.** Add neither a readiness field nor historical provider-outcome state. Make the existing status semantics explicit.

**Rationale.** The status path does not test inference, the provider interface has no readiness capability, and ONNX loading is lazy, so neither configuration nor cached vectors can establish that the next request will succeed. A historical outcome is a different contract, not a truthful substitute for present readiness.

**Consequences accepted.** A caller cannot obtain a provider-health verdict from the status call. It uses an explicit full-text search when embeddings are unavailable and receives the existing errors when semantic or hybrid evaluation fails.

**Reopen when** a concrete consumer acceptance test requires distinguishing "never attempted", "last attempt succeeded" and "last attempt failed" without invoking the provider.

### D4: one approval for two complete milestones

**Decision.** Seek one authorization for P1, P2, P3a and P3b, their required gates and all applicable P5 work, delivered in that order: P1 then P2 as the first releasable milestone, P3a then P3b as the second.

**Rationale.** The guidance milestone produces a useful result without changing retrieval, while the excerpt milestone addresses the missing match evidence with a mechanism the probe proved. The authoritative contracts are unversioned vault objects, so a code-only delivery would leave the product incompletely specified.

**Consequences accepted.** Contract authoring, skill updates and both full gates are delivery work. A blocked required gate or knowledge update blocks its milestone, and does not justify lowering the standard.

**Reopen when** a required gate or implementation dependency demonstrably requires an operation excluded from the approved scope.

### D5: prioritize the smallest complete deliveries

**Decision.** Proceed with guidance first, excerpts second and no stemming work, under the assumptions recorded below. No deadline, hard budget or additional disclosure restriction has been supplied, so none is invented.

**Reopen the priority order** when a documented release constraint applies that the excerpt milestone cannot meet but the completed guidance milestone can. The response is to release P1 and P2 and schedule the excerpt milestone afterwards, without pulling P4 into the release.

### Final MCP Descriptions After P1 And P2

These are the replacement strings for `src/lib/mcp.ts`. They describe the existing implementation and do not advertise the excerpt before P3b.

`objects_search.query`:

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more causes an error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

`objects_search.types`:

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

`objects_search.mode`:

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; local-only ONNX needs prepared, loadable model files. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. Valid requests with types: [] return no hits without invoking a provider.

`objects_search`:

> Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The body field is omitted unless includeBody is true.

`objects_status`:

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

### Excerpt Disclosure And Caller Contract

When P3b ships, this sentence is appended to the `objects_search` description and used unchanged in the documentation and the skill:

> `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

| Property | Required behavior |
| --- | --- |
| Public TypeScript shape | `readonly fulltextExcerpt?: string \| null` |
| Public MCP shape | Optional property accepting only a string or null when present |
| Concrete `SqliteIndex` | Emits the property on every hit |
| Hit with a lexical match | A string, including a hybrid hit whose `fulltextRank` is non-null |
| Hit without a lexical match | Null, including semantic-only candidates inside hybrid results |
| Older or custom producer | May omit the property; absence means no excerpt was supplied, not that no lexical match exists |
| `matchedChunk` | Unchanged semantic chunk contract; null without a semantic match |
| `body` | Emitted only when `includeBody === true` |

Excerpt availability follows the presence of a lexical match, not whether a configured fusion weight is positive.

The excerpt is generated with `snippet(<FTS table>, -1, '', '', '...', 32)` in the same statement that evaluates the match and the score, with SQLite choosing among the indexed name, title and raw columns and no particular winning column promised. The 32 is an FTS-token extraction budget, not a character or model-token limit. The public cap is applied afterwards, as the first `search.maxMatchCharacters` Unicode code points, which is 1200 by default and a validated configuration value rather than a universal constant. Native `...` markers fall inside that cap. No HTML highlighting, no coordinates and no fabricated chunk index. Source markup is treated as text, so "plain text" does not mean the content is sanitized for HTML rendering. Score, rank, filtering, ordering, generation and the existing semantic-coordinate behavior are preserved, and the whole hit including its excerpt is discarded when the existing source-checksum revalidation rejects it, with no extra per-hit read.

A caller may infer from a non-null excerpt emitted by the concrete index that the hit had a lexical match and that the text is bounded evidence selected from an indexed column. A caller may not infer that the excerpt contains every query term, contains a literal spelling of the query, identifies the highest BM25-contributing column, has raw-file coordinates, is always a partial document, or remains current after the check. A small cap can remove the visible matching term, and an excerpt is not evidence that the search was exhaustive.

### Vault Rule Text For P1 And P2

Keep the plan's existing record ownership: create or update `fulltext-query-semantics`, refine the two existing search contracts, and update the existing status interface. No readiness contract and no other diagnostic subsystem.

New contract `fulltext-query-semantics`:

> These rules govern lexical evaluation by the concrete framework in fulltext mode and the lexical component of hybrid mode.
>
> Lexical search MUST index the object's name, title and complete raw YAML Markdown document, including frontmatter and body. It MUST NOT inject the registered type name or directory name as additional searchable text.
>
> The query encoder MUST extract runs matching `[\p{L}\p{N}\p{M}]+`, deduplicate identical extracted strings, quote each retained token and combine them with AND. Deduplication and the distinct-token count MUST occur before SQLite case or diacritic folding.
>
> Lexical matching MUST use `unicode61 remove_diacritics 2`, with its case and diacritic folding and without stemming. Literal-token matching MUST NOT be described as byte-exact substring matching.
>
> Quotes and punctuation MUST NOT enable phrase matching, asterisks MUST NOT enable prefix matching, and AND, OR and NOT MUST be treated as ordinary required tokens rather than operators.
>
> When lexical evaluation runs, more than 128 distinct extracted tokens MUST fail rather than truncate the query. The current framework exposes this encoder failure as INTERNAL, not VALIDATION.
>
> A nonblank query that produces no extracted tokens MUST produce no lexical candidates. This rule MUST NOT be interpreted as suppressing semantic evaluation or its provider errors in hybrid mode.

Contract `search-bounds-enforced`:

> Framework search MUST reject a query that is not a string or is blank after trimming. It MUST reject unknown modes and unregistered type names.
>
> topN MUST default to search.defaultTopN when omitted and MUST be a safe integer from 1 through search.maxTopN.
>
> The default mode MUST be hybrid when the framework has a provider instance and fulltext otherwise. A configured provider label MUST NOT be treated as proof that the provider is usable.
>
> Omitting types MUST search across registered types. After validating the request, types: [] MUST return no hits without invoking the embedding provider. A nonempty type subset MUST restrict both lexical and semantic candidates before their ranking limits.
>
> For an otherwise valid request not short-circuited by types: [], semantic or hybrid evaluation without a provider MUST fail with EMBEDDINGS_DISABLED. For a noncancelled request, rejection of the query-embedding call MUST be surfaced as EMBEDDINGS_UNAVAILABLE.
>
> Explicit fulltext evaluation MUST NOT invoke the embedding provider. Semantic or hybrid failures MUST NOT silently fall back to fulltext; tool guidance MUST identify an explicit fulltext request as the embedding-free recovery.

Contract `search-hits-revalidated`:

> Before returning an indexed candidate, the framework MUST reread its source file and compare the raw-source checksum with the indexed checksum. A changed, missing or unreadable source MUST cause the entire hit to be omitted and reconciliation to be requested.
>
> Revalidation MUST filter the already selected candidates without refilling rejected hits to topN.
>
> indexGeneration MUST identify the index snapshot used to select the candidates. It MUST NOT be represented as a snapshot of the current filesystem.
>
> Search MUST be described as bounded and nonexhaustive. An empty result MUST NOT be presented as proof that an object is absent, and passing revalidation MUST NOT be presented as a guarantee against subsequent edits.
>
> Guidance MUST direct known identifiers to the type's get operation and source enumeration to the type's paginated list operation. It MUST NOT require a resync write before a read-only investigation.

Interface `mcp-objects-status`:

> Status MUST report the existing index and synchronization state, embedding metadata, historical reports and bounded known issues without inspecting model files or invoking inference.
>
> embeddings.provider MUST be described as the configured provider label. The embedding fingerprint and dimensions MUST be described as metadata, not a successful-inference outcome.
>
> Provider metadata, zero pending embeddings and dirty: false MUST NOT be advertised as proof of inference readiness, complete source freshness or exhaustive discovery.
>
> The issue summary MUST retain its total, truncation indicator and per-code counts. Guidance MUST distinguish this bounded report from objects_resync, which writes derived state and returns the full issue list.
>
> P1/P2 MUST preserve the current status output shape.

The applicable guarantees are mirrored in `search-api`, `mcp-objects-search` and `agent-skill-structree`, linked to the new guidance ADR and to executable evidence, preserving existing object identities, history and unrelated relations.

### Scope Submitted For Approval

> Authorize implementation of P1, P2, P3a and P3b from this plan, with the decisions and exact contracts specified here and with all applicable P5 obligations. Deliver the guidance milestone first and the excerpt milestone second. Completion of each slice's required verification and knowledge closure authorizes progression to the next selected slice without another design approval.

Authorized by that approval: the selected search descriptions, the native excerpt projection, the public types and schema, the index projection and their scoped regression tests, preserving Effect 4, strict types, the existing validation and error behavior and the prohibition on new suppressions; the stdio smoke assertion for lexical evidence; the plan's focused regression commands followed by `bun run check` and `bun run smoke:build` for each completed slice, exercising both SQLite drivers with isolated temporary fixtures and deterministic or disabled embedding providers; separate guidance and excerpt decision records with the next available ADR numbers and an index update that does not rewrite accepted history; the affected README, database, library, core-schema and embedding documentation, this plan, and the agent skill with its tool reference; and the selected P5 knowledge-authoring updates to the authoritative vault contracts, interfaces, entities, ADRs, criteria and test records, reading current revisions first, preserving unrelated content, using the latest `expectedChecksum`, validating relation targets and reading back every touched record.

Explicitly excluded: P4 in any part, including tokenizer configuration, the wrapper allowlist expansion, tokenizer activation and ranking-policy changes; new readiness or history fields, model probes, new provider behavior, automatic fallback, fuzzy search, synonyms, prefix syntax and query expansion; dependency additions, lockfile changes, installs, network access, real embedding endpoint calls, model downloads and model preparation; live-cache rebuilds or deletion, explicit live-vault resync operations, operational deployment or reconnection, and OpenCode or server configuration changes; bulk source-object migration, unrelated vault edits, and versioning or staging the ignored vault; browser tooling, real OpenCode tests, commits, pushes, staging and git-configuration changes; and weakening, skipping or replacing a required gate to obtain a passing result.

### Execution Assumptions

No fixed deadline, hard implementation budget or numerical performance target applies beyond the supplied scope and gates. Authorized search users may receive the bounded source-content excerpts defined above, and `includeBody` is not a confidentiality control. Published field meanings and the advertised schema define the compatibility target, and existing or custom producers that omit the new field remain supported. No usable embedding provider or prepared model is assumed, so ordinary verification uses mocks or disabled providers. Installed dependencies are used as-is, and the two-driver native probe is evidence of SQL feasibility rather than evidence that every repository gate will pass. Vault access uses the existing authorized environment, and the work does not acquire permission to change configuration or obtain models to make that access succeed.

The existence of an undisclosed business deadline or disclosure obligation cannot be determined from code. The default that lets the work start is that no additional constraint applies beyond these assumptions.
