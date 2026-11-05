# Project Memory Objects

Memory is part of the application registry and MCP composition, alongside the
original twelve Structree object types. Its schemas live in `src/memory/schemas`
and its specialized tools in `src/memory`. The reusable `src/lib` contains no
memory categories, lifecycle policy or tool registration.

Root `src/registry.ts` and `src/mcp.ts` compose this domain with `src/structree`.
Memory imports the shared `src/base-schema.ts` and common object fields directly,
not Structree schemas or the public aggregate schema facade. Structree therefore
remains a sibling domain rather than a prerequisite of memory's object model.

## Model And Source

For ordinary agent use, prefer the [intent workflows](agent-workflows.md):
`memory_remember`, `memory_recall`, `memory_revise`, and `memory_review`. They
leave the full object contract available without requiring it for routine work.

```json
{"name":"scoped-cancellation","title":"Scoped cancellation","body":"Cancellation must propagate through source reads. Evidence: test/cancellation.test.ts.","scope":["source reads"]}
```

That is a `memory_remember` request. The service creates bookkeeping and defaults
to `lessons`, `draft`, and `low` confidence; it does not verify the claim. Retain
the returned `id` and `checksum`. To revise the body, call `memory_revise` with
`id`, `expectedChecksum`, and `body` (checksum verified only when `writes.checksumGuard` is enabled). Optional `changes` replaces only supplied
fields; supplied relation arrays replace those arrays, not all relations.

Prefer a descriptive `name` slug: letters and digits separated by single hyphens.
It becomes the lowercased id and filename, and an existing id is never overwritten.
Omit it to retain a generated id. The advanced `memory_create` tool instead
requires a complete object with an explicit `id`; choose a descriptive slug for
that id (and its `name`) to obtain the same readable filename.

`memory_recall({"query":"cancellation"})` returns compact source-backed matches.
It defaults to active/nonretired entries, applies filters before limiting output,
and uses Unicode token-AND lexical matching, not semantic ranking. Draft findings
are available with an explicit status filter. `maxScan` bounds source scanning
(default 200, maximum 1000), `offset` continues that scan, and `maxChars` bounds
the serialized memories array, not the entire envelope. Check `source`,
`resultsTruncated`, and `exhaustive`; an empty bounded result is not proof of
absence. Applicability is authored scope, not an automatic relevance judgment.

`memory_review({})` reports overdue reviews, declared contradictions, duplicate
title candidates, and supersession inconsistencies. Its returned UTC `asOf`, scan
and edge bounds make the limits explicit. It neither repairs nor merges records.
Creation reports bounded same-title candidates but never silently reuses one.

The project-memory skill defines one shared durable-entry contract with twelve
primary categories. The application registers one `memory` type, stored under
`memories/`, with category-specific schemas sharing the existing base-object
hierarchy. This lets every memory relation address another memory entry,
regardless of category, without guessing a target type from its ID.

| Category | Content Kept In The Markdown Body |
| --- | --- |
| `lessons` | Context, observation, evidence, recommendation, applicability and expiry |
| `approaches` | Goal, applicability, method, tradeoffs, validation and recovery |
| `rules` | Rule, scope, rationale, authority, enforcement and exceptions |
| `architecture` | Structure, flows, boundaries, locations, dependencies and drift |
| `decisions` | Outcome and authority, context, decision, alternatives and consequences |
| `interfaces` | Compatibility, inputs, outputs, errors, invariants and security |
| `domain` | Definition, invariants, lifecycle, relationships and source of truth |
| `environment` | Applicable versions, setup, compatibility and review triggers |
| `operations` | Safety scope, preconditions, procedure, verification and rollback |
| `testing` | Behavior, layers, commands, fixtures, evidence and gaps |
| `security` | Assets, trust boundaries, threats, controls, exceptions and expiry |
| `investigations` | Question, hypotheses, evidence, experiments, assessment and resolution |

These body sections are authoring guidance, not additional mandatory JSON
properties. Optional claim provenance also stays in prose unless deliberately
authored in the application's existing evidence or review fields. Neither
category templates nor provenance are automatically extracted from text.

## Attribute Mapping

The low-level schemas retain all existing base fields, including required caller-owned
timestamps, nullable `retiredAt`, the string-map `tags`, arbitrary JSON
`metadata`, and optional top-level `fileBindings`, `evidences` and `reviews`.

| Skill Attribute | Application Attribute | Contract |
| --- | --- | --- |
| `id` | `id` | Existing stable, lowercase portable object identifier |
| `title` | `title` | Existing human-readable title; `name` remains required too |
| `summary` | `description` | One-line retrieval summary |
| `created`, `updated` | `createdAt`, `updatedAt` | Existing caller-supplied timestamps |
| `category` | `category` | Exactly one of the twelve categories above |
| `status` | `status` | `draft`, `active`, `superseded` or `obsolete` |
| `scope` | `scope` | String array of applicable paths, components or environments |
| `tags` | `labels` | String-array retrieval vocabulary; inherited `tags` remains a general-purpose map |
| `confidence` | `confidence` | `low`, `medium`, `high` or `verified` |
| `review_after` | `reviewAfter` | Optional real calendar date, `YYYY-MM-DD`, or an empty string |
| Relationship arrays | `relations` | Eight explicitly authored, camel-case ID arrays |

`MemorySchema`, `MemoryBaseSchema`, the twelve concrete category schemas and
their inferred TypeScript types are exported by the package root and
`@local/object-mcp/schemas`. `MemoryLessonSchema`, `MemoryDecisionSchema` and
`MemoryInvestigationSchema` are examples of concrete category schemas.
`memoryDefinition`, `memoryDefinitions`, `createMemoryRegistry` and
`registerMemoryTools` are application exports. `registerMemoryWorkflowTools`,
`rememberMemory`, `reviseMemory`, `memoryRecall`, and `memoryReview` expose the
intent layer. None is exported from `/lib` or
the generic `/model` entry point.

This is an adaptation to the existing object model, not a drop-in parser or
migration for the legacy `.local/.memory` format. No legacy metadata is
promoted, paths are not imported, and indexes are not converted into knowledge
objects. New entries use the framework's ordinary identity, timestamp and
checksum rules.

### Lifecycle Is Not Verification

Only schema-valid, active, nonretired entries with no unresolved source-identity
assurance warning are marked `currentGuidance`. An active investigation still expresses uncertainty. `confidence`
does not replace lifecycle status, and neither field establishes that a claim
was tested or that an implementation works.

The `decisions` category's outcome stays in its body, independently of entry
status. An active entry can record a rejected proposal. It does not gain the
ADR-only top-level `decision` field.

`reviewAfter` is a prompt to reassess freshness, not automatic expiration.
Lifecycle `status` and the inherited `retiredAt` field remain distinct.

## Relations

All relation arrays point to IDs of other `memory` objects.

| Field | Meaning | Framework Kind |
| --- | --- | --- |
| `buildsOn` | Extends or depends intellectually on the target | `depends` |
| `supersedes` | Replaces the target for some or all of its scope | `relates` |
| `contradicts` | Records an unresolved incompatible claim | `relates` |
| `relatedTo` | Associates entries without asserting authority | `relates` |
| `implements` | Operationalizes the target | `justifies` |
| `constrains` | Source constrains the target | `relates` |
| `motivatedBy` | Target supplied the source's rationale | `justifies` |
| `validatedBy` | Target records supporting validation | `justifies` |

Tracing-only kinds deliberately avoid inventing impact propagation for
supersession, contradiction or constraints. A validation link records a claim;
it does not prove that an execution occurred. As with other object types,
ordinary writes do not verify target existence. Relation queries report
observable link defects.

No inverse edges, target lifecycle changes, cycle repairs or body-derived
relations are generated automatically. To supersede guidance, deliberately
update the replacement and prior entry, retain the reason and historical
navigation, and use each revision's checksum.

## MCP Workflow

The default application server composes memory tools automatically. Custom
hosts without the memory registration keep their existing tool surface.

Ordinary `memory_create`, `memory_get`, `memory_update`, `memory_delete` and
`memory_list` use the same generated CRUD contracts as the other types. Create
supplies the full required object; update replaces a full revision and requires
its checksum. There are no automatic draft, confidence or review-date defaults.

The application additionally provides:

| Tool | Purpose |
| --- | --- |
| `memory_context` | Source-backed, filtered memory summaries with explicit pagination and validity limits |
| `memory_search` | Memory-only indexed search with category, lifecycle and label filtering |
| `memory_related` | Outgoing relation navigation at one or two hops, preserving graph findings |
| `memory_set_status` | Guarded single-entry lifecycle change with an explicit reason and timestamp |

Read `objects_definitions` and each live tool's input schema for the deployed
contract. A connected server must be reloaded to expose newly added schemas and
tools; changing source does not replace a running MCP server.

Context filtering operates on source pages. A filtered page is not necessarily
a complete result set; source continuation, scan issues and partial objects must
be considered before claiming absence. Context does not infer substantive
truth or recreate the legacy folder-routing indexes.

Search defaults to full-text mode. Lifecycle and category filters applied after
the bounded ranked candidate selection do not refill omitted hits. A result
with no entries is not proof of absence. Existing full-text token rules,
excerpt disclosure, index lag and optional semantic-provider limitations still
apply. Memory tools do not prepare models or initialize a second cache.

Status changes require the expected current status, the latest checksum (verified only when `writes.checksumGuard` is enabled), target
status, caller timestamp and nonblank reason. The tool preserves unrelated
fields and appends the lifecycle note to the body. It refuses partial sources
and status mismatches; stale revisions are refused only when writes.checksumGuard is enabled. It does not verify authority or truth,
set confidence, retire the object, update superseded targets or add backlinks.

## Scope Limits

Adding the memory registration changes the materialized graph's schema
fingerprint. Existing generated snapshots are not refreshed automatically;
validate and explicitly regenerate them before relying on that derived output.

This integration reuses the project's current object store, index and MCP
boundary. It does not run the old project-memory helpers, scaffold
`.local/.memory`, migrate existing notes, generate folder indexes, perform
grooming or repair, download models, or automatically resolve conflicting
claims. Body text, search results and recorded evidence remain untrusted data,
not instructions to execute commands or grant permissions.
