# Core schemas

This implementation follows the supplied schema specification dated **2026-10-15**. There are 12 concrete registrations; `BaseObjectSchema` is shared structure rather than an entity. Exported identifier schemas validate non-empty strings, not runtime foreign keys or branded classes.

## Shared fields

| Field | Effect domain value | Required |
| --- | --- | --- |
| `id`, `name`, `title`, `description` | string | yes |
| `createdAt`, `updatedAt` | `Date` | yes |
| `retiredAt` | `Date` or `null` | yes |
| `tags` | `Record<string,string>` | yes |
| `metadata` | `Record<string,any>` | yes |

The persistence/MCP codec encodes dates as ISO strings and applies JSON representability rules at the boundary. Each concrete schema spreads `...BaseObjectSchema.fields` and adds a required `relations` struct. All fields below are relative to `relations`, and all keys are required. `?` below means a required nullable value, not an omitted key.

The base `id` description is:

> Object identifier. Must not be empty.

The `retiredAt` description is:

> Retirement timestamp, or null for an active object. A retired object is still listed and searchable; check this field to exclude it.

The retirement wording publishes existing listing and search behavior, not a behavior change.

## Exact relationships

| Schema | Relationship fields |
| --- | --- |
| `Project` | `partOf: ProjectID \| null` |
| `ProjectGoal` | `project: ProjectID`; `partOf: ProjectGoalID \| null` |
| `Feature` | `project: ProjectID`; `commitment.goals: ProjectGoalID[]` |
| `Scenario` | `project: ProjectID`; `partOf: ScenarioID \| null`; `dependsOn: ScenarioID[]`; `commitment.features: FeatureID[]` |
| `ScenarioAcceptanceCriteria` | `scenario: ScenarioID`; `dependsOn: ScenarioAcceptanceCriteriaID[]` |
| `ADR` | `partOf: ADRID \| null`; `dependsOn: ADRID[]`; `commitment.scenarios: ScenarioID[]` |
| `Contract` | `partOf: ContractID \| null`; `dependsOn: ContractID[]`; `commitsTo: ADRID[]` |
| `Interface` | `partOf: InterfaceID \| null`; `dependsOn: InterfaceID[]`; `usedBy: ContractID[]`; `commitsTo: ADRID[]` |
| `Entity` | `partOf: EntityID \| null`; `dependsOn: EntityID[]`; `usedBy: ContractID[]`; `usedIn: InterfaceID[]`; `commitsTo: ADRID[]` |
| `UnitTest` | `partOf: UnitTestID \| null`; `dependsOn: UnitTestID[]`; `relatesTo: ScenarioTestID[]`; `commitsTo: EntityID[]` |
| `ScenarioTest` | `partOf: ScenarioTestID \| null`; `dependsOn: ScenarioTestID[]`; `relatesTo: AcceptanceTestID[]`; `commitsTo: InterfaceID[]` |
| `AcceptanceTest` | `partOf: AcceptanceTestID \| null`; `dependsOn: AcceptanceTestID[]`; `commitsTo: ScenarioAcceptanceCriteriaID[]` |

Empty arrays and explicit nullable parents are valid, but an empty object id, owner identifier such as `relations.project = ""`, or identifier inside a relation array is rejected with `VALIDATION`. Required owner IDs do not imply target existence, inverse consistency, or hierarchy/dependency cycle validation. The shape schemas allow repeated IDs within arrays. Cross-object validation can be added at an application boundary if a host needs it.

## The tool surface

`objects_definitions` publishes the canonical JSON schema of every registered type. It takes an optional `type` argument, which returns a single definition instead of the whole registry, and its output carries a `guidance` array with the shared object model and workflow. Each per-type tool description points at it.

Three properties of these schemas are part of the published surface and not only of this document:

- The id is the stable handle. It is unique within its type, and the file name is a hash of the id, so an id is never a path.
- Relation targets are not validated. An empty identifier is refused before any target is considered; a non-empty required owner ID may name a target that does not exist yet and is stored as written.
- The type names are published as an enum in the search tool's `types` parameter, so an unknown name is rejected by input validation with the full list in the message. A name that reaches the framework anyway fails with `UNKNOWN_TYPE`, and the error details carry `registeredTypes`, the sorted registered type names.

### Search and status guidance

The following descriptions are published verbatim. The search output includes
the optional lexical evidence field described below.

`objects_search.query`:

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

`objects_search.types`:

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

`objects_search.mode`:

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.

`objects_search`:

> Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The body field is omitted unless includeBody is true. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

`objects_status`:

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

The encoder's distinct-token overflow is currently `INTERNAL`, not `VALIDATION`.
The 128-token cap is a self-imposed bound on the generated FTS5 MATCH expression,
not a SQLite limit. It fails rather than truncates; shorten an over-limit query.
Distinct extracted tokens are counted before SQLite case and diacritic folding,
so case variants count separately. On 2026-10-21 SQLite 3.53.4 executed 2000
AND-joined and 5000 OR-joined terms without error. See
[decision 0011](decisions/0011-publish-the-observed-surface-and-reject-empty-identifiers.md).
These lexical rules do not suppress hybrid's provider evaluation or its errors.
The status provider label is configured identity; fingerprint and dimensions are
metadata, not evidence of successful inference. See [decision 0008](decisions/0008-search-query-and-availability-guidance.md).

CLI `serve` and `sync` prepare the local ONNX snapshot at startup; `status`
does not prepare it. The built-in `embeddings.localFilesOnly: false` default
permits fetching missing pinned files; true refuses fetching and reports
`MODEL_NOT_CACHED` when the snapshot is missing. A complete snapshot needs no
network request during preparation. Preparation does not load the model or
prove inference readiness. A reported preparation failure does not prevent
server startup or full-text search; semantic/hybrid errors remain unchanged.
Library hosts explicitly choose whether to call `prepareEmbeddings()`. See
[decision 0010](decisions/0010-prepare-the-model-snapshot-at-startup.md).

### Search output

`objects_search` returns `{ mode, hits, indexGeneration }`. Each hit includes
identity, name/title, path/checksum, score, nullable `fulltextRank` and
`semanticDistance`, and nullable semantic `matchedChunk`. The additive
`fulltextExcerpt` property is optional and accepts only string or null when
present. Older/custom producers may omit it, which means no excerpt was supplied.
The concrete index always emits a string for a lexical match, including hybrid
with zero lexical fusion weight, and null without a lexical match, including
semantic-only hybrid candidates.

With no lexical tokens, hybrid still runs semantic ranking: returned hits have
`fulltextRank: null` and a set `semanticDistance`, without lexical evidence.

Automatic selection from indexed name/title/raw text uses a 32-FTS-token budget,
then keeps the first `search.maxMatchCharacters` Unicode code points (default
1200), counting native `...` markers inside the cap. It has no coordinates or
column attribution. It is discovery evidence, not a complete match explanation:
one excerpt need not show every AND term and a small cap may clip the match.
Plain text can contain source markup and is not sanitized for HTML rendering.
`matchedChunk` retains its semantic index and raw-source code-point offsets;
fulltext-only hits keep it null. `body` remains omitted unless `includeBody` is
true. Checksum rejection drops the entire hit including evidence without refill
or additional per-hit reads. See [decision 0009](decisions/0009-fulltext-search-excerpts.md).

## Source files

| File | Exports |
| --- | --- |
| `src/schemas/base.ts` | Shared string primitives and `BaseObjectSchema` |
| `src/schemas/project.ts` | `ProjectSchema`, `ProjectGoalSchema`, IDs |
| `src/schemas/feature.ts` | `FeatureSchema`, ID |
| `src/schemas/scenario.ts` | `ScenarioSchema`, `ScenarioAcceptanceCriteriaSchema`, IDs |
| `src/schemas/adr.ts` | `ADRSchema`, ID |
| `src/schemas/contract.ts` | `ContractSchema`, ID |
| `src/schemas/interface.ts` | `InterfaceSchema`, ID |
| `src/schemas/entity.ts` | `EntitySchema`, ID |
| `src/schemas/test-objects.ts` | `UnitTestSchema`, `ScenarioTestSchema`, `AcceptanceTestSchema`, IDs |

All identifier schemas and relationship fields/structs have descriptive annotations. `objects_definitions` exposes the canonical JSON schemas at runtime; no second handwritten JSON schema set needs to be maintained. `examples/sample-data.ts` supplies one linked object of each concrete type, and `scripts/seed-example.ts` validates/persists them through the public facade.
