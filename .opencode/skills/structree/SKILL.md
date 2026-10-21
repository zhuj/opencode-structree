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

Use the advertised query guidance:

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more causes an error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

The type-filter and mode guidance is:

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; local-only ONNX needs prepared, loadable model files. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. Valid requests with types: [] return no hits without invoking a provider.

The search tool states:

> Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The body field is omitted unless includeBody is true. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

Use a few content words, not the words of the type name. Two words can match
anywhere, not necessarily together; `reconcil*` searches `reconcil`, not every
word starting with it. `cafe` can match `café`. Repeated identical tokens do
not use extra distinct-token slots, but case variants can count separately
before folding. Overflow currently returns `INTERNAL`, not `VALIDATION`.
Hybrid's provider can fail before lexical evaluation, including for punctuation
only. Fulltext is embedding-free, not a promise that every request succeeds.
Search's `matchedChunk` is nullable and semantic, not lexical evidence.
Use `fulltextExcerpt` as lexical discovery evidence, not a complete match
explanation. The concrete server emits a string for a lexical match, including
hybrid with zero lexical fusion weight, and null for semantic-only hits, including
hybrid candidates. Older/custom producers may omit it; absence only means no
excerpt was supplied. Automatic selection may return name/title or raw
frontmatter/body text, not every AND term or the highest-scoring column.
The 32-FTS-token extraction budget is followed by a cap of the first
`search.maxMatchCharacters` Unicode code points (1200 by default), including
native `...` markers. A small cap or long token can clip the visible match.
There are no coordinates, column provenance, HTML highlighting or fabricated
chunk indexes; source markup is text, not sanitized HTML. The unchanged semantic
`matchedChunk` has `{ index, start, end, text }` with raw-source code-point offsets
and remains null for fulltext-only hits. `includeBody` controls only the `body`
property, not content disclosure. Revalidation discards stale/unreadable hits
with their evidence, without refill, and does not guarantee freshness afterwards.
Confirm absence only after a complete successful paginated listing of the
relevant type; a failed or incomplete listing does not establish absence.

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

`objects_status` states:

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

The configured provider label, fingerprint and dimensions are metadata, not
proof of usability. Known issues are diagnostics, not an exhaustive health check.

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
- **Search can miss.** Confirm a known id with `get` and fully paginate the
  relevant type's list for enumeration. Resync is a write, not a prerequisite
  for a read-only investigation.
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
| `EMBEDDINGS_DISABLED` | No provider instance exists and you asked for semantic or hybrid | Use `mode: "fulltext"` |
| `INTERNAL` after a long lexical query | More than 128 distinct extracted tokens can exceed the encoder limit | Use fewer distinct content tokens; report other internal failures |
| `UNKNOWN_TYPE` | The type name is wrong | The error details carry `registeredTypes`, the names that exist |
| `ALREADY_EXISTS` | The id is taken | `get` that id and update it, or choose another id |
| `CHECKSUM_CONFLICT` | The revision moved since you read it | `get` it again and reapply your change |
| `IMMUTABLE_ID` or `IMMUTABLE_CREATED_AT` | The update tried to change a frozen field | Keep the original values |
| Validation error naming a field | The schema wants a field you omitted; every base field is required | Check `objects_definitions` for the type |
| A search misses an object you know exists | Results are bounded and the searchable state can be behind the last change | Confirm a known id with `get`; fully paginate the type's list for enumeration; resync only when a write is permitted |

## References

- `references/object-model.md`: every type, its fields and the target type of
  every relation.
- `references/tool-reference.md`: every tool, its parameters, its limits and
  what it returns.
