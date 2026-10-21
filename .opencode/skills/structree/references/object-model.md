# The object model

Every registered type shares the same base fields. All of them are required by
the schema, including the ones that are empty.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | non-empty string | The stable handle. Unique within the type, and the target of every relation. An id is never renamed. |
| `name` | string | A short machine-ish name, often the same as the id suffix. |
| `title` | string | The human-readable title. |
| `description` | string | One line. The detail belongs in the body. |
| `createdAt` | string | ISO timestamp. Set by the caller, immutable afterwards. |
| `updatedAt` | string | ISO timestamp. Set by the caller, moves forward on update. |
| `retiredAt` | string or null | Retirement timestamp, or null for an active object. A retired object is still listed and searchable; check this field to exclude it. |
| `tags` | object of string to string | Free-form labels. |
| `metadata` | object | Additional JSON-compatible values. |
| `relations` | object | The edges, shaped per type. See below. |

The body is the Markdown content of the object. It is separate from
`description`, and it is what full-text search matches against.

## Relation shapes

Two shapes appear in the relations, and they are easy to get wrong:

- `partOf` is a single id or `null`. The key must be present; the value may be
  `null`.
- A list-valued relation is an array of ids. The key must be present; an empty
  array is a valid value.
- A `commitment` is an object with one or more named lists, not a bare array.
  `feature.commitment` is `{ "goals": [...] }`, `scenario.commitment` is
  `{ "features": [...] }`, and `adr.commitment` is `{ "scenarios": [...] }`.

Relation targets are not validated by the server. An empty identifier is refused
before any target is considered: an empty object id, owner identifier such as
`relations.project = ""`, or identifier inside a relation array fails with
`VALIDATION`. A non-empty id naming a target that does not exist is stored as
written, and nothing warns you later. Empty arrays and nullable parents remain
valid. The retirement wording above publishes existing listing and search
behavior, not a behavior change.

## Per type

### `project`

Projects and their optional parent projects.

| Relation | Shape | Target |
| --- | --- | --- |
| `partOf` | string or null | `project` |

### `project_goal`

Goals owned by projects.

| Relation | Shape | Target |
| --- | --- | --- |
| `project` | string | `project` (required owner) |
| `partOf` | string or null | `project_goal` |

### `feature`

Project features and their commitments to goals.

| Relation | Shape | Target |
| --- | --- | --- |
| `project` | string | `project` (required owner) |
| `commitment.goals` | string[] | `project_goal` |

### `scenario`

Project scenarios and their feature commitments.

| Relation | Shape | Target |
| --- | --- | --- |
| `project` | string | `project` (required owner) |
| `partOf` | string or null | `scenario` |
| `dependsOn` | string[] | `scenario` |
| `commitment.features` | string[] | `feature` |

### `scenario_acceptance_criteria`

Acceptance criteria owned by scenarios.

| Relation | Shape | Target |
| --- | --- | --- |
| `scenario` | string | `scenario` (required owner) |
| `dependsOn` | string[] | `scenario_acceptance_criteria` |

### `adr`

Architecture decision records and their scenario commitments.

| Relation | Shape | Target |
| --- | --- | --- |
| `commitment.scenarios` | string[] | `scenario` |
| `partOf` | string or null | `adr` |
| `dependsOn` | string[] | `adr` |

### `contract`

Contracts and their architecture decision commitments.

| Relation | Shape | Target |
| --- | --- | --- |
| `partOf` | string or null | `contract` |
| `dependsOn` | string[] | `contract` |
| `commitsTo` | string[] | `adr` |

### `interface`

Interfaces used by contracts.

| Relation | Shape | Target |
| --- | --- | --- |
| `partOf` | string or null | `interface` |
| `dependsOn` | string[] | `interface` |
| `usedBy` | string[] | `contract` |
| `commitsTo` | string[] | `adr` |

### `entity`

Entities used by contracts and interfaces.

| Relation | Shape | Target |
| --- | --- | --- |
| `partOf` | string or null | `entity` |
| `dependsOn` | string[] | `entity` |
| `usedBy` | string[] | `contract` |
| `usedIn` | string[] | `interface` |
| `commitsTo` | string[] | `adr` |

### `unit_test`

Unit tests and their entity commitments.

| Relation | Shape | Target |
| --- | --- | --- |
| `partOf` | string or null | `unit_test` |
| `dependsOn` | string[] | `unit_test` |
| `relatesTo` | string[] | `scenario_test` |
| `commitsTo` | string[] | `entity` |

### `scenario_test`

Scenario tests and their interface commitments.

| Relation | Shape | Target |
| --- | --- | --- |
| `partOf` | string or null | `scenario_test` |
| `dependsOn` | string[] | `scenario_test` |
| `relatesTo` | string[] | `acceptance_test` |
| `commitsTo` | string[] | `interface` |

### `acceptance_test`

Acceptance tests and their commitments to scenario acceptance criteria.

| Relation | Shape | Target |
| --- | --- | --- |
| `partOf` | string or null | `acceptance_test` |
| `dependsOn` | string[] | `acceptance_test` |
| `commitsTo` | string[] | `scenario_acceptance_criteria` |

## The graph the relations describe

```
project ──owns──> project_goal ──committed to by──> feature
   │                                       ▲
   └──owns──> scenario ──committed to by──┘
                │
                ├──owns──> scenario_acceptance_criteria
                │                        ▲
                │                        └──committed to by──> acceptance_test
                └──committed to by──> adr ──committed to by──> contract
                                                     ├──uses──> interface
                                                     └──uses──> entity

unit_test ──relates to──> scenario_test ──relates to──> acceptance_test
```

The chain from `scenario_acceptance_criteria` to `acceptance_test` through
`commitsTo` is the one that answers "which test proves this requirement".
The chain from `scenario` to `feature` through `commitment` is the one that
answers "which feature delivers this behavior".
