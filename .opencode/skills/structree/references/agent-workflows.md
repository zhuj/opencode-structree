# Memory, Progress And Handoffs

## Choose The Right Owner

Reusable findings belong in memory. Current objectives, checkpoints, blockers and
next actions belong in progress. Accepted decisions, requirements and test
definitions belong in their canonical project-intent objects. Link or cite those
owners rather than inventing a second approval or completion ledger.

Reuse the selected tracker for work already in flight. Do not copy an existing
local or external task into Structree just because its tools are available.
For new work tracked in Structree, keep one owning work item; use hierarchy and
dependencies only when they help. This guide does not authorize a tracker cutover.

Only use advertised tools. This guide describes the application surface, not a
guarantee that an already-running server has loaded the newest implementation.

## Small Requests

`memory_remember` requires `title` and `body`. Optional category, scope, labels and
evidence clarify applicability. The service generates identity and bookkeeping;
defaults are `lessons`, `draft`, and `low` confidence. Saving a finding does not
activate it or prove it. Same-title candidates are advisory, never automatic
merges. Search before creating a near-duplicate and revise the existing owner
when appropriate.

`memory_revise` requires `id`, `expectedChecksum`, and intentional `changes`
and/or a replacement `body`. Omitted content survives; supplied arrays replace
those arrays. Read the latest revision after a checksum conflict, then reapply
only the intended change. Never retry with a fabricated checksum.

`memory_recall` requires `query`. It defaults to active/nonretired memories,
matches all Unicode word tokens, and returns source-backed excerpts with scope,
evidence, uncertainty and checksums. It does not infer whether the authored scope
applies to your task. Use a few topic words, not a paragraph or query operators.
Draft findings require an explicit status filter. A bounded scan is not an
exhaustive absence check: inspect continuation, diagnostics and truncation.
`maxChars` bounds the memories array, not the entire response envelope.

`memory_review` reports overdue reviews, declared contradictions, duplicate-title
candidates and supersession inconsistencies within explicit scan/edge bounds.
Review findings are not truth judgments or repair authorization.

`progress_plan` requires `title` and `outcome`; acceptance, next action and owner
are useful when known. It creates `planned` work without mandatory hierarchy.
Keep the returned id/checksum. `progress_update` records a checkpoint and/or
intentional changes against that checksum. Use explicit blockers plus a concrete
next action for `blocked`; `paused` work remains resumable.

To revise a plan or interview rationale, supply only the intended `title`,
`outcome`, `acceptance` or replacement `body` to `progress_update` and explain why
in `checkpoint.note`. This adds one guarded checkpoint, preserves omitted fields,
and does not imply approval or refreshed verification. `acceptance: []` and
`body: ""` deliberately clear content. Read the existing body before extending
it, because the body is replaced in full; use `work_item_get` to retrieve it.
Title does not rename identity, and outcome does not replace `description`.

Verification is separate from work status. Report `not-run`, `pending`, `failed`
or explicitly evidenced `passed` honestly. Completed implementation is not
automatically accepted. A citation or asserted test result is authored evidence,
not proof that Structree executed the test.

Omitting verification preserves the last authored result and its `recordedAt`;
a later checkpoint neither reruns checks nor proves that result is still fresh.
When reporting `passed`, supply evidence or a test result in that explicit
verification update. Record the real check scope and remaining limitations.

## Resume And Finish

Find current work with `progress_review`, following source-page continuation even
when a filtered page is empty. Read a known item with `progress_resume`; it does
not activate paused work. Check next action, recent checkpoints, blockers,
dependency findings and verification gaps before continuing.

Partial or identity-unverified sources are diagnostic-only, not normal work
summaries. A targeted resume or session call refuses an unverified root with a
source diagnostic; do not substitute a guessed objective or next action.
Resolve the ambiguity through separately authorized source repair, not a forced
write. An exhausted source page can still have `exhaustive: false` when diagnostics
or scan issues prevent classifying matching work. Absence needs complete,
successful enumeration, not an empty filtered page.

Use a small review `limit` and known-id resume to control context. Progress has
field/page bounds but no total character budget; do not describe it as token
bounded. Resume includes the latest five checkpoints and their total count;
use `work_item_get` only when full history or source content is needed.

`session_context({ id, query })` combines that work summary with bounded memory
recall. Without `query`, knowledge is not requested, not found absent. Pick a
short topic query deliberately rather than assuming the whole objective is a
useful token-AND query. Context can be incomplete or change after reading.

At handoff, save a concise checkpoint with evidence and the next action. At
finish, record the real implementation status and remaining verification gaps.
Promoting a reusable conclusion is a separate deliberate memory update; never
copy the entire task log or automatically promote on completion. Do not migrate
legacy stores, remove local tools, or enable dual writes as part of these calls.
