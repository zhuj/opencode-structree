# Agent-Friendly Memory And Progress

## Accepted Direction

Structree should make it easy for an agent to start work, recall relevant knowledge,
save a useful finding, checkpoint, and hand work off. It should not reproduce the
local memory/progress tool inventory or require an agent to administer storage.
The user approved implementation of this direction on November 2, 2026.

Memory and progress serve different purposes. Memory preserves reusable project
knowledge with applicability, provenance and uncertainty. Progress preserves an
objective, acceptance conditions, current state, blockers, evidence and the next
action. Accepted architectural decisions remain canonical ADRs, not competing
memory summaries with independent approval state.

## Interaction Contract

The normal path uses small intent-shaped requests rather than complete objects:

| Journey | Expected Interaction |
| --- | --- |
| Recall | Ask about a topic; receive bounded, applicable source context and limitations. |
| Remember | Supply a title and useful content; the service supplies mechanical bookkeeping, not authority. |
| Revise | Identify a known revision and intentional changes; preserve everything omitted. |
| Review Knowledge | Inspect stale reviews, declared conflicts and duplicate candidates without automatic repair. |
| Plan Work | Supply an intended outcome; hierarchy is optional. |
| Update Work | Save a checkpoint, next action, blocker or explicit status change against a known revision. |
| Resume Work | Recover objective, acceptance conditions, recent checkpoints, blockers and verification gaps; optionally recall knowledge. |
| Review Work | Find current or paused work through bounded source-backed discovery. |

Creation may generate identifiers, timestamps and other mechanical defaults.
Memory defaults must remain conservative. No tool may manufacture evidence,
confidence in truth, acceptance, test execution, or approval. Existing object-level
APIs remain available for specialized operations and compatibility.

## Safety And Completeness

- Writes use the existing source/checksum guard. Stale updates must fail rather
  than overwrite a newer checkpoint or finding.
- A partial or ambiguous source is a diagnostic, never current guidance.
- Recall applies eligibility before its output limit and reports scan limits;
  exhausted output budgets or filtered pages are not proof of absence.
- Read workflows do not repair sources, set up models, or change lifecycle state.
- Work can be paused and resumed. Blocked work needs a reason and a next action.
- Implementation completion and acceptance verification are distinct. A completed
  item with pending verification must remain visibly unverified.
- Dependencies and parent links are explicit, not inferred. Missing targets and
  cycles cannot silently become satisfied dependencies.
- Checkpoint capture is selective. No automatic transcript ingestion, task-log
  promotion, duplicate merging, supersession or evidence fabrication is allowed.

## Delivery And Validation

Deliver memory and progress as separate application domains, compose the resume
experience at the application boundary, and keep the reusable object library
domain-neutral. A fresh agent must be able to plan, recall, checkpoint and resume
without knowing storage paths or full internal schemas.

Exercise those journeys with deterministic fixtures, including concurrent writes,
partial sources, filtered recall, paused/blocked work and pending verification.
Inspect tool contracts and response size as well as passing tests. Record a
baseline before promising numerical call/token reductions; do not invent a
performance target or claim measured LLM usability from synthetic tests alone.

Migration, pilot cutover, harness configuration changes, removal of local tools,
and deletion of legacy records are separate future decisions. This implementation
does not authorize them or introduce dual writes.
