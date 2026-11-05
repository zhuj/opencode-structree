# Resumable Work

Progress is an application domain alongside Structree project intent and durable
memory. It stores `work_item` objects in `work-items/`. `src/progress` owns its
schemas, workflows and MCP adapter; root composition registers the domain.
The generic library does not acquire task lifecycle policy.

## Normal Agent Journey

Plan a small task without constructing an internal object:

```json
{
  "name": "clarify-cancellation",
  "title": "Clarify cancellation behavior",
  "outcome": "Source reads preserve caller cancellation.",
  "acceptance": ["A cancelled request stops before reading subsequent sources."],
  "nextAction": "Inspect the source-read cancellation tests."
}
```

Send this to `progress_plan`. Keep its returned `id` and `checksum`. Work begins
as `planned`; optional `owner`, `parentId`, and `dependencies` express real
ownership and relationships, not a mandatory hierarchy.

Prefer a descriptive `name` slug: letters and digits separated by single hyphens.
It becomes the lowercased id and filename; duplicate ids are rejected. If omitted,
the id is generated. The advanced `work_item_create` tool requires a complete
object with an explicit `id`; choose a descriptive slug for that id (and its
`name`) to obtain the same readable filename.

Record a checkpoint with `progress_update`:

```json
{
  "id": "<returned work id>",
  "expectedChecksum": "<latest checksum>",
  "status": "paused",
  "checkpoint": {"note": "Relevant paths located; behavior has not yet been tested."},
  "nextAction": "Add a regression test for cancellation between source reads.",
  "verification": {"state": "not-run"}
}
```

The service generates checkpoint timestamps, preserves prior history and omitted body,
and performs one revision (guarded when `writes.checksumGuard` is enabled). Omitted fields survive. Explicit empty blocker
or dependency arrays clear those fields; `parentId: null` clears a parent.
When `writes.checksumGuard` is enabled, a stale checksum fails rather than discarding someone else's checkpoint; by default the checksum is not verified.

### Revise The Plan Or Work Body

`progress_update` also accepts optional `title`, `outcome`, `acceptance` and
`body`. Supplying any of these requires an explicit `checkpoint.note` explaining
the revision (guarded checksum when enabled), even when clearing a list or body. For example:

```json
{
  "id": "<returned work id>",
  "expectedChecksum": "<latest checksum>",
  "outcome": "Cancellation stops between source reads without model setup.",
  "acceptance": ["No subsequent source is read after cancellation."],
  "body": "## Scope\n\nExercise source-read cancellation only.\n",
  "checkpoint": {"note": "Narrowed this work to the observed source-read boundary."}
}
```

All supplied fields are replaced in one guarded revision with one appended
checkpoint. Omitted fields survive. Retrieve existing body text before extending
it: `body` replaces the entire body, not a patch. `body: ""` and `acceptance: []`
intentionally clear content. Title/outcome/acceptance retain the planning bounds:
200/4000 characters and at most 50 nonblank acceptance strings of 2000 characters.
Changing title does not rename `id`, `name` or the file; changing outcome does not
rewrite `description`. Revision does not imply owner approval, completion or a
verification reset. The output remains a summary; `work_item_get` retrieves the
full body. Older connected servers must advertise these inputs before use.

## Status And Evidence

Work status is `planned`, `active`, `paused`, `blocked`, `completed`, or
`cancelled`. Blocked work needs explicit blockers and a next action. Reading a
paused task does not reactivate it.

Verification is independently `pending`, `not-run`, `passed`, or `failed`.
Recording `passed` requires explicit evidence or a test result. The tool does
not execute that test, inspect external evidence, or establish acceptance.
`completed` with pending/failed checks stays visibly unverified in the resume
summary. Keep test definitions distinct from execution results.

Omitted verification fields preserve the last explicitly recorded result and its
timestamp. A later checkpoint does not rerun those checks or establish their
freshness for later implementation changes. Record new verification deliberately
when the checked behavior changes; do not interpret a carried-forward `passed`
state as a fresh run.

Each update appends a bounded checkpoint without truncating stored history.
Resume summarizes the latest five checkpoints and reports the total. Use normal
object reads for full history or advanced edits; the compact intent surface is
not a second source of truth.

Field and page limits bound these responses, but progress summaries do not yet
have a total character/token budget. For large tasks, request a small review page
and fetch known work items directly. Memory recall has a separate explicit
character budget; neither limit is a measured guarantee of LLM usability.

## Resume And Review

`progress_review({})` discovers planned, active, paused and blocked work from
one bounded source page. Optional exact status/owner filters do not change what
the source continuation counts. Follow continuation even after an empty filtered
page. Partial sources remain diagnostics, not valid work summaries.

`progress_resume({"id":"<work id>"})` returns the objective, acceptance,
blockers, next action, recent checkpoints, verification gaps and dependency
readiness. Missing, partial, unverified or cyclic graph targets remain findings,
never implicitly completed dependencies. Graph inspection is bounded and not a
cross-object transaction; concurrent/external edits can invalidate a prior result.

`session_context({"id":"<work id>","query":"cancellation"})` combines that
work summary with bounded memory recall. An omitted query does not search memory
and must not be interpreted as proof that no knowledge exists. Recall defaults
to active/nonretired knowledge and token-AND lexical matching; choose a short
topic query deliberately.

No read operation changes status, repairs storage, sets up an embedding model,
or promotes task logs into durable memory. At a checkpoint, deliberately record
only reusable verified conclusions in memory, referencing their task/evidence.
Legacy migration and harness cutover remain outside this implementation.
