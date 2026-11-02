# Continuous Session Capture

Keep the graph aligned with material session outcomes as they happen. Capture
durable knowledge from the conversation available to you, user/agent interviews,
inspected source, and actual verification results. This is a checkpoint workflow
while the skill is active, not an autonomous transcript monitor or runtime job.

## Scope And Permission

Use this workflow when project knowledge capture is authorized, including a
standing request to keep Structree current. Do not ask again for each routine
in-scope create/update. A read-only investigation, no-write instruction, or
restricted vault overrides that default: retain the candidate changes in the
response or permitted progress record and report that persistence is pending.
Saving knowledge never authorizes implementation, tests, deployment, deletion,
source repair, resync, materialization writes, or changing an owner's decision.
Do not capture secrets, credentials, private interview details, or raw chat logs.

## The Checkpoint Loop

Run after a material interview answer or requirement change, a decision outcome,
an implementation/verification milestone, before handoff/compaction when
possible, and before the final response. Batch related changes rather than
writing after every sentence or postponing everything until session end.

1. **Extract the delta.** Identify new requirements, rationale, owner decisions,
   changed guarantees, implementation mappings, evidence, reviews, and explicit
   status changes since the last reconciled checkpoint. Separate direct user
   intent, observations, agent recommendations, hypotheses, and unknowns.
2. **Find the owner.** Reuse known IDs. For reusable findings use `memory_recall`;
   for work use the selected tracker's resume/review tools. For project-intent
   objects search relevant types in explicit `fulltext` mode, then get plausible
   owners before creating. A capped
   empty search is not proof of absence; use narrower terms or complete relevant
   pagination when a duplicate/coverage claim depends on it. Do not enumerate
   the whole vault at every checkpoint.
3. **Choose the object.** Map intent to the existing type and relation contract;
   use the table below. One conceptual owner is better than a new object for
   every turn. Do not create placeholder objects merely to complete the graph.
4. **Reconcile status and provenance.** Apply only justified status changes.
   Preserve prior rationale/history, stable IDs, and known limitations. Cite a
   real source when available; otherwise record a concise attributed statement
   in the body with known date/context, not an invented path or approval.
5. **Persist with tools.** Use `memory_remember/revise` for findings and
   `progress_plan/update` for work owned in Structree. For project-intent objects,
   read the current revision first, then use a full per-type update for
   content/relations or focused field update for top-level-field-only changes.
   Preserve all metadata, immutable fields, body,
   unrelated relations, and earlier evidence/reviews. On checksum conflict,
   reread and reconcile; never force overwrite. Compact tools supply mechanical
   timestamps; full-object and focused-field writes need actual caller timestamps.
6. **Reconcile the receipt.** Confirm the response names the intended object and
   revision, and report tool errors/partial success rather than claiming all
   changes saved. For changed relations use `objects_relations` to inspect
   relevant defects/impact. Read back only when the response is insufficient or
   an ambiguity remains. A recorded relation is not proof of implementation.
7. **Close the checkpoint.** Briefly report materially changed IDs/statuses,
   verification limits, and any unsaved candidates. When nothing durable changed,
   make no write and do not create a review just to log that the skill ran.

## Extraction Targets

| Session outcome | Object or field |
| --- | --- |
| Project objective or desired capability | `project_goal` or `feature`; preserve ownership/commitments. |
| Actor behavior, constraint, or observable acceptance condition | `scenario`, its criteria, or an existing `contract`. |
| Decision, alternatives, approval, rejection, withdrawal, replacement | `adr` with top-level `decision`, rationale and evidence. |
| Public API, boundary guarantee, or domain shape | `interface`, `contract`, or `entity`, linked intentionally. |
| A real test definition or changed coverage | Existing test kind and its actual commitments; distinguish planned from implemented. |
| Inspected implementation/test/doc attachment | Top-level `fileBindings` for current files, not historical citations. |
| Supporting source, documented owner decision, or actual test-result artifact | Top-level `evidences`, with a real project-relative source path. |
| A completed scoped review | Top-level `reviews`, with limitations and known revision/working-tree state. |
| Reusable finding, lesson, scoped guidance, or uncertain investigation | Memory intent tools; preserve evidence, confidence and lifecycle explicitly. |
| Task activity, retries, blockers, or temporary hypotheses | The existing progress owner; use Structree progress when selected, without duplicating local/external tracking. |

## Status And Evidence Discipline

Decision statuses are only `proposed`, `accepted`, `rejected`, `superseded`, and
`withdrawn`. A suggestion is not accepted because an agent prefers it. An
interview answer can clarify a requirement without approving a whole plan.
Record concrete alternatives as proposed only when worth retaining. Preserve
the owner's exact acceptance/cancellation scope; ask when ambiguity materially
changes it. Do not change a previous status merely because new work started.

Memory and work items have their own lifecycles; follow
[agent workflows](agent-workflows.md), not ADR decision statuses. The remaining
project-intent types have no universal status field. Follow an existing verified
tag convention or describe state in the body. Distinguish requested, planned,
implemented, inspected, tested, and verified. Do not infer completion from an
agent summary or coverage link. A passing run applies only to its actual
revision, selector, environment, and limitations; stale historical results stay
historical. A failed/not-run check does not invalidate unrelated evidence, but
cannot support a current pass claim.

Evidence/review arrays are replacements, not append operations. Read and retain
earlier entries; update an existing entry only to correct its same observation,
not to erase an earlier result with a later one. Use new stable entry IDs for
distinct observations. If no durable result file exists, record the exact known
command, outcome, scope, and limitations in the body or an authorized progress
record. Do not invent an evidence artifact or use review time as execution time.

Metadata is general-purpose JSON. Do not reserve its keys, infer statuses or
attachments from them, or automatically promote legacy values into structured
fields. Confirm the connected definitions/tools before writing: an older server
may not yet support the top-level fields or `objects_fields_get/update`. Report
that mismatch rather than falling back to the old metadata interpretation.

Maintain typed relations and body wikilinks deliberately. Extracting meaning
from conversation does not authorize the canceled automatic wikilink-to-relation
feature: never scan body links to derive/add/prune frontmatter references.

## Examples

- **“Consider SQLite, but do not implement it yet.”** Find the relevant ADR;
  record a worthwhile candidate as proposed, preserving that implementation is
  unapproved. Do not mark it accepted or implemented.
- **“Yes, accept option B; cancel A.”** Update the actual decisions and rationale
  according to whether A was rejected, withdrawn, or displaced by B. Do not
  choose between those meanings if the distinction is unresolved.
- **“Tests passed yesterday; we changed the parser today.”** Preserve yesterday's
  result as historical. Record today's changed implementation mapping; do not
  claim the new parser passed without a relevant run.
- **“This interview changes the limit from 10 to 20.”** Update the existing
  scenario/criterion and identify affected tests/contracts. Record the owner's
  changed requirement, not a fabricated test result or duplicate criterion.
- **Read-only interview.** Extract the candidate updates and report them unsaved.
  Do not call write tools or widen permission just to satisfy continuous capture.
