---
name: structree
description: "Read and write the project's structured knowledge vault through the structree MCP server: projects, goals, features, scenarios, acceptance criteria, ADRs, contracts, interfaces, entities and the three test kinds, stored as typed Markdown objects with relations between them. Use this whenever the answer depends on what the project already knows or decided (what is in the vault for X, which criteria cover Y, what was decided about Z, what does this interface or contract guarantee, which test proves this), whenever you are about to write a decision, requirement or test that might duplicate something already recorded, and whenever the outcome of the task should become a durable object instead of staying in the chat. Also use it before writing an ADR, a plan or a test plan, to check what already exists."
compatibility: Requires the structree MCP server to be registered in the session.
metadata:
  surface: mcp
  audience: agents
---

# Using structree

## What this is for

structree keeps a project's structured knowledge as a graph of typed objects.
Every object has a set of fields, a Markdown body and typed relations to other
objects, and a search index over them is derived so it can be queried. The MCP
server exposes both the objects and the index.

Two things follow from that shape, and they are the reason to use it.

- The answer is grounded in the project's own record rather than in a summary of
  the code you happened to read this session. Every object carries an id, and
  every relation points at an id, so a claim can be traced back to the object
  that states it.
- The output of the work is an object. A decision, a requirement, a criterion
  and a test that links to it are stored where the next session will find them,
  instead of being typed into a chat that scrolls away.

## When to use it

Use the vault when:

- the task depends on what the project already knows: an existing feature, the
  criteria that cover a behavior, the decision behind a design, the guarantees
  an interface gives, the test that proves something;
- you are about to write something the vault is supposed to hold, and you want
  to know whether it already exists before you add a second version of it;
- the result should outlive the session: a decision, a goal, a requirement, a
  test, a mapping from one of those to the code.

Do not use it when:

- the code, the tests or the docs in front of you are the better source. The
  vault describes intent and structure; the code describes behavior. Reading
  the code is cheaper and more accurate for "how does this work today";
- you are storing scratch output, logs, or anything the object model has no
  shape for;
- you would be inventing content to fill a gap. Objects should record what is
  real. An empty vault area is a fact about the project, not a task.

## The object model

Every object carries the same base fields: `id`, `name`, `title`, `description`,
`createdAt`, `updatedAt`, `retiredAt`, `tags`, `metadata`, `relations`. The
relations differ per type and are what makes the graph.

| Type | Holds | Relations |
| --- | --- | --- |
| `project` | A project, optionally under a parent project | `partOf` to a project |
| `project_goal` | A goal of a project | `project` to a project, `partOf` to a goal |
| `feature` | A feature of a project | `project` to a project, `commitment.goals` to project goals |
| `scenario` | A scenario of a project | `project` to a project, `partOf` to a scenario, `dependsOn` to scenarios, `commitment.features` to features |
| `scenario_acceptance_criteria` | A criterion of a scenario | `scenario` to a scenario, `dependsOn` to criteria |
| `adr` | An architecture decision record | `commitment.scenarios` to scenarios, `partOf` to an ADR, `dependsOn` to ADRs |
| `contract` | A contract | `partOf` to a contract, `dependsOn` to contracts, `commitsTo` to ADRs |
| `interface` | An interface | `partOf` to an interface, `dependsOn` to interfaces, `usedBy` to contracts, `commitsTo` to ADRs |
| `entity` | A domain entity | `partOf` to an entity, `dependsOn` to entities, `usedBy` to contracts, `usedIn` to interfaces, `commitsTo` to ADRs |
| `unit_test` | A unit test | `partOf` and `dependsOn` to unit tests, `relatesTo` to scenario tests, `commitsTo` to entities |
| `scenario_test` | A scenario test | `partOf` and `dependsOn` to scenario tests, `relatesTo` to acceptance tests, `commitsTo` to interfaces |
| `acceptance_test` | An acceptance test | `partOf` and `dependsOn` to acceptance tests, `commitsTo` to acceptance criteria |

The full field list per type, including which relation holds which target type
and whether it is required, is in `references/object-model.md`.

Two properties of the relations are worth knowing before you write:

- **Relation targets are not validated.** A link to an id that does not exist is
  stored as written. Get the target ids first, so the graph stays walkable.
- **`commitment`, `commitsTo` and `relatesTo` are how intent meets reality.**
  They are the only thing that connects a criterion to the test that proves it,
  or an interface to the decision that justifies it. Filling them in is usually
  the most valuable thing you can add.

## How to use it

The tools are exposed by the MCP server. On the wire they are named
`<type>_<verb>` (`project_get`). In code mode they are namespaced under the
server name (`tools.structree.project_get`), and a host that prefixes local MCP
tools presents them as `structree_project_get`. The full inventory is in
`references/tool-reference.md`.

### 1. Start from the definitions

Call `objects_definitions` first when you are new to the surface, and whenever a
call is rejected for a field you believed was optional. It returns the live
JSON Schema of every registered type, and the server's own guidance about the
workflow. It accepts an optional `type` argument to return one type.

The schema is the authority. This document describes the contract as it stands;
the server you are talking to is what actually validates.

### 2. Find before you list

`objects_search` is the way in. Use it with a `types` filter so the result is
the kind of object you are looking for:

```jsonc
{ "query": "commitment", "types": ["scenario_acceptance_criteria"], "topN": 10 }
```

- `mode` defaults to `hybrid` when an embedding provider is configured and
  `fulltext` otherwise. Full-text always works, so it is the safe default when
  you do not know what the session has configured.
- Search returns matched objects with a score, a rank and a matched chunk. The
  bodies are omitted unless you pass `includeBody: true`.
- Search is not exhaustive. It is capped by `topN` and it can miss recent
  changes. When you know the id, `get` is cheaper and exact; use search to
  discover ids, and confirm an absence against an exhaustive listing before
  you conclude that something is missing.

Listing a whole type is the expensive path. It is right when you want to
enumerate everything of one kind, and wrong when you want to find one object.

### 3. Read one object

`<type>_get({ id })` returns the object, its Markdown body, its path and its
checksum. The checksum is not decoration: it is what authorizes the next write.

### 4. Write

Every object needs all of its fields, including the null ones. `retiredAt` is
`null` for a live object, and `relations` is an object even when empty.

**Create** supplies every field. Timestamps are yours to set, not the server's:

```jsonc
{
  "object": {
    "id": "adr-the-graph-is-the-project-intent",
    "name": "The Graph Is the Project Intent",
    "title": "The Graph Is the Project Intent",
    "description": "Why the recorded graph, not the code, answers what the project intends.",
    "createdAt": "2026-10-20T10:00:00Z",
    "updatedAt": "2026-10-20T10:00:00Z",
    "retiredAt": null,
    "tags": {},
    "metadata": {},
    "relations": { "commitment": { "scenarios": ["scenario-x"] }, "partOf": null, "dependsOn": [] }
  },
  "body": "# The Graph Is the Project Intent\n\n..."
}
```

**Update** replaces the whole revision. It is not a patch: send the complete
object, including the fields you are not changing, plus the `expectedChecksum`
from the last read. The `id` and `createdAt` are immutable; `updatedAt` moves
forward.

**Delete** needs the id and the latest checksum.

When you update, read first and write back what you read. The checksum is the
guard against overwriting a revision someone else produced in between.

### 5. Check the state

`objects_status` is a snapshot: index generation, object counts, the registered
types, embedding state, the last error, and a bounded issue list with
`issuesTotal`, `issuesTruncated` and `issuesByCode`. It is cheap to call.

`objects_resync` refreshes the searchable state and reports every issue it
found. It is the repair path when a search misses something you know exists,
and it is the only tool that returns the full issue list. It writes derived
state, so it is not a read-only call: leave it out of an investigation that
must not change anything.

## Rules that keep the vault consistent

- **The id is the handle.** It is stable, unique within its type, and it is
  what every relation points at. Renaming an id is a new object with a broken
  link, not a rename.
- **Checksums authorize writes.** Update and delete need the checksum of the
  revision they replace. Read before you write.
- **Timestamps belong to the caller.** The server records what you send. Send
  the real time of the change.
- **Relations are not checked, so check them.** Nothing stops you from
  committing a link to an id that does not exist, and nothing will warn you
  later.
- **Search can miss.** Confirm a known id with `get`, and resync when the index
  looks stale.
- **Use the canonical field names.** Fields that are still unrecognized after
  validation are rejected. Some servers repair recognizable input mistakes
  before validating, and report what they changed in the response metadata;
  do not rely on the repair, and check the metadata when a field seems to have
  been changed for you.

## Cost discipline

The vault is large enough that a careless read can eat the context you needed
for the work.

- One `get` beats a list of fifty.
- Pass `includeBody: false` to a list call when you only need identity, title,
  path and checksum. It drops the body text and keeps the object fields, so
  the saving depends on how large the bodies are.
- Search returns bodies only when you ask for them, so leave `includeBody`
  unset while you are narrowing down, and fetch the body with `get` afterwards.
- Keep `topN` small. Ten hits is usually enough to find the object.

## Worked examples

**"What does the project already know about X?"**

1. `objects_search({ query: "X", types: ["scenario", "adr", "contract"] })`.
2. Read the two or three hits that matter with `<type>_get`.
3. Answer with the object ids in the answer, so the reader can look them up.

**"Record this decision."**

1. `objects_search({ query: "<the decision's topic>", types: ["adr"] })` to see
   whether it already exists. A near-duplicate ADR is worse than no ADR.
2. Create the ADR with `commitment.scenarios` pointing at the scenarios it
   serves, and `partOf`/`dependsOn` when it extends or depends on another.
3. Report the new id.

**"Which tests prove this behavior?"**

1. Start from the criterion: `objects_search({ query: "<the behavior>", types: ["scenario_acceptance_criteria"] })`, then `get` it.
2. Find the acceptance tests that claim it: search `types: ["acceptance_test"]` and read their `commitsTo` relations, which point at acceptance criteria.
3. Follow `relatesTo` for the rest of the chain: a scenario test points at acceptance tests, a unit test points at scenario tests. Their `commitsTo` relations point at interfaces and entities, not at criteria.
4. A search that finds nothing is not proof that nothing exists: the result is capped and can miss recent changes. Paginate the list of the relevant type before you report a coverage gap, and record a new test object only once the gap is confirmed, not because a search was empty.

## Failure modes

| Symptom | What happened | What to do |
| --- | --- | --- |
| `EMBEDDINGS_UNAVAILABLE` | The embedding provider failed, so semantic or hybrid search cannot run | Search again with `mode: "fulltext"` |
| `EMBEDDINGS_DISABLED` | No provider is configured and you asked for semantic or hybrid | Use `mode: "fulltext"` |
| `UNKNOWN_TYPE` | The type name is wrong | The error details carry `registeredTypes`, the names that exist |
| `ALREADY_EXISTS` | The id is taken | `get` that id and update it, or choose another id |
| `CHECKSUM_CONFLICT` | The revision moved since you read it | `get` it again and reapply your change |
| `IMMUTABLE_ID` or `IMMUTABLE_CREATED_AT` | The update tried to change a frozen field | Keep the original values |
| Validation error naming a field | The schema wants a field you omitted; every base field is required | Check `objects_definitions` for the type |
| A search misses an object you know exists | The searchable state can be behind the last change | Confirm a known id with `get`; use `objects_resync` when the searchable state is stale |

## References

- `references/object-model.md`: every type, its fields and the target type of
  every relation.
- `references/tool-reference.md`: every tool, its parameters, its limits and
  what it returns.
