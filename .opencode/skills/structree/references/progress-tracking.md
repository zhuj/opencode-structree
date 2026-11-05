# Progress Tracking

Progress owns objectives, task state, intermediate reasoning, checkpoints and
handoffs. Preserve enough context for another session to continue without
repeating interviews or mistaking hypotheses for confirmed findings. Adapt the
original progress-tracking discipline to Structree; do not use the legacy
`local.progress_*` tools, MJS helpers or `.local/.progress` as this skill's backend.

## One Work Owner

Use one Structree `work_item` for a coherent task, not a timestamped file and
index plus a second live tool ledger. Tool calls and filesystem access operate on
the same source. The included default is
`.local/.structree/objects/work-items/<id>.md`; discover the actual source root
and registered directory before filesystem operations.

Preserve the existing selected tracker for already-tracked work. Do not copy an
unfinished legacy task or external issue into Structree automatically. Migration,
dual writes, deletion and harness reconfiguration need separate authorization.
Plans/specifications may link the work owner; do not mirror its live checklist.

## Start Or Resume Without Setup Ceremony

Use a known ID with `progress_resume({ id })`. Otherwise use a small
`progress_review({ limit: 5 })` page and follow its source continuation to locate
the owner. Default review includes planned, active, paused and blocked work;
completed/cancelled work needs an explicit status filter. Retired work is excluded.
Do not assume an empty filtered page means no work exists, and do not enumerate
the whole vault or load every schema at every session start.

Confirm the outcome, next action, recent checkpoints, blockers, dependency
findings and verification gaps before continuing. Resume is read-only and does
not activate paused work. It includes the latest five checkpoints and their
total count; use `work_item_get` or the source when older history matters.

`session_context({ id, query: "topic words" })` adds relevant active/nonretired
memory. Without query, knowledge is **not requested**, not found absent. Choose
the query deliberately; token-AND recall can miss a paragraph-shaped objective.
Work and knowledge are independent reads, not a cross-object snapshot.

## Choose The Operation

Use only advertised Structree tools; these calls have no legacy `root` argument.
The connected server selects its vault. There is no start/init/index ritual.

| Intent | Tool | Effect |
| --- | --- | --- |
| Find current work | `progress_review({ limit, offset, status, owner })` | Bounded source page, no activation |
| Resume known work | `progress_resume({ id })` | Summary, revision and dependency findings |
| Start authorized work | `progress_plan({ title, outcome })` | Planned/pending work with generated bookkeeping |
| Checkpoint or change state | `progress_update({ id, expectedChecksum, checkpoint: { note }, nextAction })` | Change with appended checkpoint; checksum enforcement is configurable |
| Revise the plan or rationale | `progress_update({ id, expectedChecksum, title, outcome, acceptance, body, checkpoint: { note } })` | Supply only intended replacements and the reason |
| Read full history/body | `work_item_get({ id })` | Complete source and checksum |
| Combine work and knowledge | `session_context({ id, query })` | Explicit bounded handoff |
| Validate records | `objects_validate({})` | Read-only source schema diagnostics |

Supply optional `acceptance`, `nextAction` and `owner` to planning when known.
Small work needs no hierarchy. Independently owned subtasks may use `parentId`
and `dependencies`; parents link children rather than copy their activity.
Use actual returned IDs, not invented references. A plan is not permission to
execute its implementation or verification steps.

## Checkpoints And Lifecycle

States are `planned`, `active`, `paused`, `blocked`, `completed`, `cancelled`.
They are not the legacy active/blocked/completed/abandoned transition protocol.
Use the latest checksum, not a `from` field. `writes.checksumGuard` defaults to
false, so coordinate concurrent writers unless enforcement is enabled. Do not infer a stricter transition
graph than the current schema/tools enforce. `retiredAt` is separate from state.

At a material decision, discovery, failed verification, pause, phase gate or
handoff, record a concise checkpoint and concrete next action. Preserve scope,
user approval, rationale/alternatives, confirmed observations, uncertainty and
verification limits. Do not log every command, copy raw output or invent phase
history. Put longer acceptance reasoning and interview outcomes in the work
body through `progress_update`; retain prior history and explain the revision.

An update preserves omitted fields and appends exactly one checkpoint. Supplying
`title`, `outcome`, `acceptance` or `body` requires an explicit `checkpoint.note`
explaining why the plan or content changes. Ordinary state changes can still use
generated notes. Supplied arrays replace the list. `blockers: []` clears blockers;
`parentId: null` removes a parent. For blocked work, record an explicit blocker
and retain or supply a meaningful next action. Never mark acceptance done from
an agent summary alone.

On checksum conflict, reread the latest work item and reconcile the intended
delta. Do not blindly replay a stale update or fabricate a checksum. Review
diagnostics and partial outcomes before claiming a save. Record an extra resume
checkpoint only when it preserves material new context.

## Revise A Plan Without Full-Object CRUD

Read the latest owner, then send only intended replacements:

```json
{
  "id": "<returned work id>",
  "expectedChecksum": "<latest checksum>",
  "acceptance": ["Cancellation stops before the next source read."],
  "body": "## Scope\n\nCover cancellation between reads; model setup is excluded.\n",
  "checkpoint": {"note": "Owner narrowed the scope to cancellation between reads."}
}
```

Use real rationale and approval provenance, not the illustrative claim above.
`title` is at most 200 characters, `outcome` 4000, and `acceptance` at most 50
nonblank strings of 2000 characters each. `body` replaces the whole Markdown body,
not an append or patch: retrieve and retain earlier context when adding a section.
`body: ""` and `acceptance: []` are intentional clears, not omission. They still
require a checkpoint reason. Title changes do not rename `id`, `name` or the
file; outcome changes do not rewrite the separate `description`. Other fields,
stored history and verification survive unless deliberately changed. A saved
revision is not approval or a fresh passing check. Read full body/history with
`work_item_get`; update responses remain summaries.

Use this path only when the connected schema advertises the new fields. With an
older server, keep an explicit proposal or use an authorized guarded full update;
do not silently lose changes, restart the server or bypass a tool denial.

## Completion Is Not Verification

Verification is separately `pending`, `not-run`, `passed` or `failed`. Mark work
completed only for the implementation scope actually finished; record unresolved
checks honestly. An explicit passed update requires evidence or a test result
in that update. Describe the real command/probe, revision, scope and limitations;
the tool stores authored evidence, it does not execute tests or prove acceptance.
`acceptanceEstablished: false` remains explicit even with recorded passed checks.

Omitted verification retains the earlier result and `recordedAt`. A later
checkpoint is not a fresh run. Reassess affected evidence when implementation or
inputs change, without inventing automatic invalidation. Record the final outcome,
checks, remaining limitations and next action at handoff; finishing a task does
not automatically approve a decision, create memory or satisfy a parent's criteria.

Dependency readiness requires recorded completion and supported passed
verification, not independently executed proof. Missing, partial or unverified
targets and bounded traversal can leave readiness uncertain. The tools reject
observed cycles, but do not guarantee cross-object transactional graph integrity
against concurrent/external writers. Inspect findings instead of overriding them.

## Filesystem, Diagnostics And Boundaries

Use [filesystem access](progress-filesystem.md) for offline source reads and
authoring. Missing tools do not authorize server startup, installation, model
setup or configuration changes. Do not bypass a denied write through files.
Source repair, resync, generated-output writes and deletion are separate actions.

Partial/identity-unverified sources remain diagnostics, not ordinary task
summaries. Targeted resume/session refuses an unverified root; do not invent its
objective or silently repair it. Source-page exhaustion is not exhaustive matching
when diagnostics remain. Inspect `source.complete`, `issues`, `continuation` and
`exhaustive`. Progress fields/pages are finite, but there is no total character
or token budget: use small pages and full-source reads only as needed.

## Promote Deliberately

Use [project memory](project-memory.md) for reusable, supported lessons within memory-write
authorization. Search for the existing knowledge owner, distill the conclusion,
and cite the work ID/path and evidence with freshness limits. Do not copy the
whole checkpoint log, promote on completion automatically, or turn an uncertain
task hypothesis into current guidance. Use the main Structree guidance for canonical
requirements, decisions, tests and their traceability rather than duplicating
those approvals inside a progress record.
