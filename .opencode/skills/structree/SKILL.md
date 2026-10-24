---
name: structree
description: "Read and write the project's structured knowledge vault through the structree MCP server: projects, goals, features, scenarios, acceptance criteria, ADRs, contracts, interfaces, entities and the three test kinds, stored as typed Markdown objects with relations between them. Use this whenever the answer depends on what the project already knows or decided (what is in the vault for X, which criteria cover Y, what was decided about Z, what does this interface or contract guarantee, which test proves this, what breaks if that decision changes, which decisions to review if that scenario changes), whenever you are about to write a decision, requirement or test that might duplicate something already recorded, and whenever the outcome of the task should become a durable object instead of staying in the chat. Also use it before writing an ADR, a plan or a test plan, to check what already exists."
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

- **Relation targets are not validated.** You may send an id in any case. The
  framework lowercases the object id, owner identifiers such as
  `relations.project`, and every other relation identifier at the very start of
  create, get, update and delete, below the tool boundary, then checks the
  lowercased form against the [portable stored-id domain](references/object-model.md).
  A valid id that names no existing target is still stored after normalization.
  Get the target ids first, so the graph stays walkable.
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

> Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.

The type-filter and mode guidance is:

> Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.

The CLI prepares the local ONNX provider for `serve` and `sync`, not `status`.
The built-in `embeddings.localFilesOnly` default is false, permitting missing
pinned model files to be fetched. True retains offline-only behavior: a missing
snapshot reports `MODEL_NOT_CACHED` without fetching. A complete snapshot needs
no network request during preparation. Preparation leaves the model unloaded;
inference loads it lazily when needed. A preparation failure is reported without
stopping the server or full-text search. Library hosts decide whether to call
`prepareEmbeddings()`; framework creation does not prepare automatically.
Do not treat successful preparation or status metadata as proof of working
inference, and do not change provider configuration to repair a failed query.

The search tool states:

> Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking. Search is not exhaustive: topN is a maximum, recent or invalid objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate valid objects. The server's startup reconciliation runs in the background, so a search issued right after it starts may find nothing; objects_status reports whether a synchronization is still running. The body field is omitted unless includeBody is true. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

Use a few content words, not the words of the type name. Two words can match
anywhere, not necessarily together; `reconcil*` searches `reconcil`, not every
word starting with it. `cafe` can match `café`. Repeated identical tokens do
not use extra distinct-token slots, but case variants can count separately
before SQLite case and diacritic folding. The cap is a self-imposed bound on the
generated FTS5 MATCH expression, not a SQLite limit; it fails rather than
truncates. On 2026-10-21 SQLite 3.53.4 executed 2000 AND-joined and 5000 OR-joined
terms without error. See [decision 0011](../../../docs/decisions/0011-publish-the-observed-surface-and-reject-empty-identifiers.md).
With no lexical tokens, hybrid hits have `fulltextRank: null` and a set
`semanticDistance`.
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

### 4. Follow the relation graph

`objects_relations` is the exact path for questions about what a change
reaches. It reads the Markdown sources, so it reflects the vault on disk.

```jsonc
{ "type": "adr", "id": "adr-flat-search-namespace", "mode": "impact", "depth": 3 }
```

The two modes answer two different questions:

- `neighbors` returns the relation edges adjacent to the object. `direction`
  selects which way the walk follows the stored edges: `outgoing` from the
  source to the target, `incoming` the reverse. An edge keeps the label of the
  walk that first reached it, so the label does not change with the depth.
- `impact` returns the objects a change to the root reaches. It follows the
  relation kind, not the stored direction: a change to the target of a
  `depends`, `justifies`, `contains` or `owns` relation propagates to the
  holder, and a change to the holder of a `uses` relation propagates to the
  target. The impact mode rejects the `direction` argument.

`edgeKinds` defaults to `depends`, `uses` and `justifies` in the impact mode.
`contains` and `owns` are organizational and `relates` carries no impact, so
ask for them explicitly when the hierarchy matters. `depth` is the number of
hops, from 1 to 10.

The `findings` array reports the link defects the model does not prevent:
`DANGLING_TARGET`, `TARGET_TYPE_MISMATCH`, `AMBIGUOUS_TARGET` and `CYCLE`. A
finding appears only when the defect lies within the queried depth. A type
mismatch is worth reporting to the user, because the link is still followed
but the object does not mean what the field says. A target that names no
object is not in the answer set, because it is not an object; its edge and its
finding still report the broken link.

#### Local materialized graph tools

Use `objects_relations` for exact, current vault impact. Use the local CLI for
offline/snapshot file bindings, traceability reports, diagrams and graph diffs,
or when a local CLI workflow is preferred. These are CLI commands, not MCP
tools. Markdown remains authoritative; the generated graph is derived,
disposable data, not a replacement for source-backed reads or write checksums.

Run from the project root. The read commands load `<out>/graph.ts`, defaulting
to `.local/.structree/materialized`, without starting the framework, loading
configuration, reconciling sources or preparing a model. They do not change
Markdown. The loader imports the generated data module, so use trusted generated
output, not arbitrary TypeScript supplied as a snapshot.

Representative commands (replace the example paths and ids):

```bash
bun src/cli.ts lookup --file src/service.ts --root project --strict
bun src/cli.ts impact --of adr:adr-example --depth 3 --include-retired=false
bun src/cli.ts coverage --origin scenario_acceptance_criteria --evidence acceptance_test --kind justifies
bun src/cli.ts diagram --of adr:adr-example --kinds depends,justifies
bun src/cli.ts diff --base snapshots/before --compare snapshots/after
```

- `lookup` requires an explicit `--root vault|project`; it does not guess the
  file binding's root.
- `lookup`, `impact`, `coverage` and `diagram` accept `--out <dir>`. `impact`
  also accepts `--kinds a,b`; `coverage` accepts `--require-active=true` to
  require active evidence (the default is false). `diagram` accepts `--types
  a,b` and `--title <text>`, and returns Mermaid text inside JSON.
- `diff` compares two output directories, with optional `--ignore-body`.
  Exit `0` means equal and `2` means different; usage, load or runtime errors
  exit `1`. The other read commands return `0` on success and `1` on error.
- For TypeScript consumers, `@local/object-mcp/graph-tools` exports the pure
  helpers `lookupByFile`, `impactReport`, `traceability` and `renderMermaid`;
  `@local/object-mcp/graph-diff` exports `diffGraphs`.

Before relying on a snapshot after changes, run the read-only gate against the
intended vault configuration and output directory:

```bash
bun run gate:materialization
# Optional for a nondefault vault/output:
bun run gate:materialization --config path/to/config.yaml --out path/to/output
```

The gate performs strict validation (valid vault, zero partial objects), then a
non-writing drift check. Exit `0` means strict-clean, `2` means invalid/partial
sources or output drift, and `1` means a usage/configuration/runtime failure.
Do not claim freshness if it fails; use authoritative MCP reads instead, or
regenerate with `bun run materialize` only when generated-output writes are
explicitly allowed, then rerun the gate. A pass describes the checked state,
not changes made afterwards.

For development only, `bun run watch:materialization [--config path] [--out dir]`
is a debounced watcher, not an MCP tool or a CI gate. With write permission it
regenerates output only when the vault is valid with zero partial objects,
preserving the previous output on invalid source. Write-mode materialization
and the watcher write generated output; `materialize --check` and the gate do
not. Coverage, graph policies and a clean gate describe recorded structure,
not proof that implementation works or that tests ran.

### 5. Write

Every object needs all of its fields, including the null ones. `retiredAt` is
`null` for a live object. A retired object is still listed and searchable; check
`retiredAt` to exclude it. This is existing behavior, not a retrieval change.
`relations` is an object even when empty.

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

### 6. Check the state

`objects_status` states:

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

The configured provider label, fingerprint and dimensions are metadata, not
proof of usability. Known issues are diagnostics, not an exhaustive health check.

The server answers requests while its startup reconciliation runs in the
background. A search issued right after startup may find nothing while existing
files await indexing; do not treat that as proof of absence. `objects_status`
reports whether a synchronization is still running, with `syncing: true` and
`lastSync: null` until a completed report exists. Create indexes its own object
immediately, so create followed by search still works during that pass.
Startup reconciliation is itself a repair path and can rename files to match
their ids after the server starts answering; it is not a read-only operation.

`objects_resync` refreshes the searchable state and reports every issue it
found. It is the repair path when a search misses something you know exists,
and it is the only tool that returns the full issue list. It writes derived
state and can rename source files, so it is not a read-only call: leave it out
of an investigation that must not change anything.

## Rules that keep the vault consistent

- **The id is the handle.** It is stable, unique within its type, and it is
  what every relation points at. The stored id is always lowercase: `MyThing`
  becomes `mything`, and a second create differing only in case fails with
  `ALREADY_EXISTS`. The file name is the id: create writes
  `<type directory>/<id>.md`. The scanner restores a differing base name in its
  existing directory and updates the indexed path, because the content is the
  source of truth. A filesystem that folds case or normalizes names may spell
  the name differently while the target still names the same file. The scanner
  accepts that spelling, leaves the file unchanged and indexed at its actual
  path, and reports no issue. Only a different file holding the target name is a
  conflict: both files remain unchanged and the object is excluded with
  `RENAME_CONFLICT`. Nothing is overwritten. Subdirectories are still supported.
  Renaming an id is a new object with a broken link, not a rename.
- **Checksums authorize writes.** Update and delete need the checksum of the
  revision they replace. Read before you write.
- **Timestamps belong to the caller.** The server records what you send. Send
  the real time of the change.
- **An empty array is not an empty identifier.** Use `[]` for a list with no
  links and explicit `null` for a nullable parent, never `""` as a placeholder.
- **Search can miss.** Confirm a known id with `get` and fully paginate the
  relevant type's list for enumeration. Resync is a write, not a prerequisite
  for a read-only investigation.
- **Relation questions go through `objects_relations`.** Searching for a
  relation id is a heuristic: it is capped, non-exhaustive, and its index can
  lag. The relation tool is exact.
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

**"What breaks if I change this decision?"**

1. `objects_relations({ "type": "adr", "id": "<the decision>", "mode": "impact", "depth": 3 })`.
2. The `affected` set is the blast radius. Each entry carries the distance and
   the kind that reached it, and the `via` path shows how.
3. Read the objects that matter with `<type>_get` before describing them, and
   report the `findings`: a `TARGET_TYPE_MISMATCH` means a link in the blast
   radius points at an object of the wrong type, so the object does not mean
   what the field says.
4. A `depth` of 1 gives the direct dependents. Raise it only when the direct
   set is not the whole answer; the set grows quickly.

**"Which decisions should I review if that scenario is changed?"**

1. `objects_relations({ "type": "scenario", "id": "<the scenario>", "mode": "impact", "edgeKinds": ["justifies"], "depth": 1 })`.
2. The result is the decisions that commit to the scenario. At depth 2 it also
   returns the contracts, interfaces and entities those decisions justify,
   which is the review set rather than the decision set.
3. Report the decision ids with their titles, so the reader can look them up.

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
| `INTERNAL` after a long lexical query | Lexical encoder overflow above 128 distinct extracted tokens | Shorten your own over-limit query; report other internal failures |
| `UNKNOWN_TYPE` | The type name is wrong | The error details carry `registeredTypes`, the names that exist |
| `ALREADY_EXISTS` | The id is taken | `get` that id and update it, or choose another id |
| `CHECKSUM_CONFLICT` | The revision moved since you read it | `get` it again and reapply your change |
| `IMMUTABLE_ID` or `IMMUTABLE_CREATED_AT` | The update tried to change a frozen field | Keep the original values |
| `VALIDATION` / `VALIDATION_ERROR` | A field is missing or invalid, including a caller-supplied identifier whose lowercased form is outside the portable stored-id domain | Supply an identifier valid after lowercasing; check `objects_definitions` for other field errors |
| A search misses an object you know exists | Results are bounded and the searchable state can be behind the last change | Confirm a known id with `get`; fully paginate the type's list for enumeration; resync only when a write is permitted |

## References

- `references/object-model.md`: every type, its fields and the target type of
  every relation.
- `references/tool-reference.md`: every tool, its parameters, its limits and
  what it returns.
