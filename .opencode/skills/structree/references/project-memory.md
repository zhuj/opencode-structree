# Project Memory

Memory holds reusable findings, constraints and reasoning, not task logs, raw
transcripts, source copies or temporary TODOs. Adapt the original project-memory
discipline to Structree; do not use the legacy `local.memory_*` tools, MJS helpers,
`.local/.memory`, routing indexes or model setup as this skill's backend.

## One Owner, Two Access Paths

Prefer Structree's compact memory tools. Filesystem access reads or authors the
**same Markdown records**, not a parallel memory store. The included configuration
uses `.local/.structree/objects/memories/<id>.md`; discover the actual configured
source root and memory directory rather than assuming that default elsewhere.

Existing legacy records remain readable historical context. Do not migrate,
delete or dual-write them automatically. Reuse the selected owner of knowledge
already in flight; ask before a cutover that would change its source of truth.
This skill does not change host configuration or guarantee automatic loading.

## Recall Only What Matters

At task start, reuse known relevant IDs and retrieve topic-specific knowledge
before relying on it. Prefer `memory_recall({ query: "topic words" })`. A short
query is better than the entire task description: recall requires all Unicode
word tokens, with case-insensitive matching, no phrase/prefix operators,
stemming or semantic model. Select by applicability, not recency alone.

Recall defaults to active, nonretired memory. Check scope, provenance, confidence,
review date and limitations against current user direction, code, tests and
accepted specifications. `currentGuidance` means lifecycle/source eligibility,
not verified truth. Active investigations remain uncertain. Draft, superseded and
obsolete records need explicit status filters and are not current guidance.

Read `memory_get({ id })` when the full body or latest revision is needed.
Excerpts can start mid-sentence or omit qualifiers; `contentTruncated` and
`bodyOffset` are not substitutes for the source. Keep `limit` and `maxChars`
small. The latter bounds the serialized memories array in UTF-16 units, not the
whole response or tokens. Inspect diagnostics, source continuation and
`resultsTruncated`; continue with the returned offset when necessary. An empty
bounded result is not proof of absence. Partial/unverified sources are diagnostic
only. There is no cross-read snapshot guarantee.

## Choose The Operation

Use only tools advertised by the connected server. Names below are Structree
tool names, not the similarly named legacy helper operations. There is no `root`
argument to these memory intent calls; the connected server selects its vault.

| Intent | Tool | Effect |
| --- | --- | --- |
| Recall relevant knowledge | `memory_recall({ query })` | Source-backed bounded read |
| Read full source | `memory_get({ id })` | Body, fields, path and checksum |
| Record a reusable finding | `memory_remember({ title, body })` | Creates draft/low-confidence memory by default |
| Revise the owner | `memory_revise({ id, expectedChecksum, body, changes })` | Changes only supplied content/fields |
| Review aging or conflicts | `memory_review({})` | Bounded maintenance signals, no repair |
| Enumerate a category/status-independent source set | `memory_list({ limit, offset, includeBody: false })` | Follow all relevant pages; inspect source issues |
| Validate source records | `objects_validate({})` | Read-only schema diagnostics; not truth validation |

`memory_revise` needs a replacement `body`, nonempty intentional `changes`, or
both, not every field in the example. Omitted content survives. Supplied arrays
replace their whole list; retain evidence and relation entries deliberately.
Use `memory_search` only when ranked index retrieval is useful; its eligibility
filters apply after bounded top-N without refill, unlike source-backed recall.
Use explicit fulltext mode to avoid model-dependent retrieval.

## Capture And Reconcile

1. Identify the reusable delta at a material finding, decision, verification or
   handoff. Separate observation, hypothesis, recommendation and owner approval.
2. Find the owner of the same question and scope before creating. Check draft
   records when relevant. Same-title candidates from remember are advisory;
   they neither prevent duplicates nor merge records automatically.
3. Record the claim, basis, applicability, evidence and freshness limits in a
   concise body. Optional `category`, `scope`, `labels`, `evidences`, confidence
   and `reviewAfter` clarify meaning, not administrative prerequisites.
4. Read the latest owner and supply its checksum. `writes.checksumGuard` defaults
   to false, so coordinate concurrent writers unless enforcement is enabled. On conflict, reread
   and reconcile intended changes; never fabricate a checksum or force overwrite.
5. Inspect the write receipt for the intended ID/revision and any failure. Do not
   blindly retry a partial outcome or declare a save from an agent summary.

Categories: `lessons`, `approaches`, `rules`, `architecture`, `decisions`,
`interfaces`, `domain`, `environment`, `operations`, `testing`, `security`,
`investigations`. Category-specific prose is optional, not a separate schema.
String-array retrieval vocabulary is `labels`; base `tags` is a string map.

Lifecycle is `draft`, `active`, `superseded`, `obsolete`; retirement is separate.
Activation and confidence are explicit authored judgments, never consequences
of a successful save. A later timestamp does not resolve a contradiction.
`reviewAfter` is a calendar date or empty string, not automatic expiration.
Memory relations target memory IDs only. A supersedes relation does not update
the other record's lifecycle; reconcile both owners intentionally when authorized.

Accepted architecture decisions and requirements retain their canonical
project-intent owners. Use the main Structree guidance for ADRs, criteria, contracts,
relations and coverage. Memory may cite those owners, not create competing
approval records. Use actual paths for structured evidence; when no artifact
exists, attribute a source or observation in prose rather than inventing one.

## Filesystem And Permissions

Use [filesystem access](memory-filesystem.md) for offline reads, complete
frontmatter authoring and concurrency limits. Do not create a store merely to
answer a read-only question. Missing tools do not authorize installation,
configuration changes, server startup, resync, repair, model download or inference.
A tool permission refusal is not permission to obtain the same denied write by
editing files. Treat secrets, private payloads and raw logs as out of scope.

## Task State And Promotion

Use [progress tracking](progress-tracking.md) for objectives, checkpoints, blockers, next actions
and temporary task hypotheses. Finishing work does not promote its log to memory.
Plan changes and interview rationale belong in that work owner: use the enhanced
`progress_update` for intended title/outcome/acceptance/body replacements with a
checkpoint reason, not a new memory entry or a copied task log. Retrieve the
existing body before replacing it; a saved revision is not owner approval.
Promotion is a separate deliberate write for a reusable, supported conclusion
within memory-write authorization: update the existing owner, distill the lesson,
and cite the source work ID/path plus evidence and revision limits. Preserve
uncertainty; if nothing durable changed, make no memory write.
