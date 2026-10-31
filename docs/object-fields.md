# Structured Object Fields

Every built-in object keeps general-purpose, JSON-compatible `metadata`. There
are no reserved metadata keys: values named `decision`, `fileBindings`,
`evidences`, or `reviews` have no special meaning inside that map.

Structured data instead lives in optional top-level object fields. All 12
Structree types support `fileBindings`, `evidences`, and `reviews`; only ADRs
support `decision`. Missing fields imply no default status or review outcome.

## Structures

| Field | Shape | Meaning |
| --- | --- | --- |
| `decision` | `{ status, decidedAt?, source? }` on ADRs only | An authored decision state, not a runtime approval or enforced transition workflow. |
| `fileBindings` | `{ root: "project", path, role, symbol? }[]` | Current implementation, test, or documentation attachments. |
| `evidences` | `{ id, kind, source, description, recordedAt? }[]` | Explicit citations supporting the object's claims. |
| `reviews` | `{ id, reviewedAt, scope, limitations, workingTree, commit? }[]` | Authored, scoped review history. |

Decision statuses are `proposed`, `accepted`, `rejected`, `superseded`, and
`withdrawn`. A superseded status does not create a graph relation to another
decision. Neither an accepted status nor a review means tests passed.

An evidence source is `{ root: "project", path, locator? }`. The path is a
portable project-relative path; the optional locator can identify a symbol,
line, or section. Evidence kinds are `source`, `test-result`, `owner-decision`,
and `documentation`. Evidence and review IDs must be unique within their
respective arrays on an object.

Review `scope` and `limitations` are string arrays. `workingTree` is `clean`,
`dirty`, or `unknown`; `commit` is optional because not every review has a known
repository revision. Timestamps are caller-authored RFC 3339 strings.

File-binding roles remain `implementation`, `test`, and `documentation`.
Materialization requires safe, existing regular project files. Normal object
writes validate binding structure, not target existence. Evidence paths are
historical citations and need not still exist. Reading or writing these fields
does not dereference evidence paths, execute tests, download artifacts, or
create links from body text.

## MCP Workflow

Normal `<type>_create` and `<type>_update` accept these fields alongside `metadata`
and `relations`, not inside `metadata`. The usual update remains a complete
replacement requiring the latest checksum.

For a focused field change, use `objects_fields_get`, then
`objects_fields_update`. Omitted fields retain their current values; supplied
arrays replace the corresponding arrays. An empty array clears a list, while
`decision: null` removes an ADR's decision block. At least one field change and
a caller-authored `updatedAt` are required.

```json
{
  "type": "adr",
  "id": "adr-example"
}
```

Use the checksum from that read in the update:

```json
{
  "type": "adr",
  "id": "adr-example",
  "expectedChecksum": "<checksum-from-read>",
  "updatedAt": "2026-10-31T20:00:00Z",
  "decision": {
    "status": "accepted",
    "decidedAt": "2026-10-31T19:30:00Z"
  },
  "reviews": [
    {
      "id": "source-review-2026-10-31",
      "reviewedAt": "2026-10-31T20:00:00Z",
      "scope": ["Decision rationale checked against source"],
      "limitations": ["No runtime tests executed"],
      "workingTree": "unknown"
    }
  ]
}
```

Focused updates preserve the entire `metadata` map, body, relations, immutable
identity, creation time, and other object fields. They use the checksum-guarded
write path: a stale revision is refused, not silently merged. Partial objects
cannot be modified through these tools.

The focused read returns `{ type, id, checksum, fields }`, where `fields`
contains only supported top-level fields actually present on the object. It
does not return `metadata` or infer fields from its contents. The update returns
the usual `{ type, object, body, path, checksum }` stored revision. The old
`objects_metadata_get/update` tools are not aliases for these operations.

## Application And Library Boundaries

Structured field schemas, types, profile interpretation, and focused tools
belong to the application layer, composed by `src/mcp.ts`. The root and
`/schemas` entry points expose application contracts; `/lib` and the generic
dependency-free `/model` entry point do not expose Structree decision, evidence,
or review contracts. Generic MCP servers do not install application tools when
handed application definitions.

The application exports `ObjectFieldsSchema`, `ADRObjectFieldsSchema`,
`ObjectDecisionSchema`, `ObjectEvidenceSchema`, `ObjectReviewSchema`,
`EvidenceSourceSchema`, `DecisionStatusSchema`, and `FileBindingSchema`,
with corresponding `ObjectFields`, `ADRObjectFields`, `ObjectDecision`,
`ObjectEvidence`, `ObjectReview`, `EvidenceSource`, `EvidenceKind`, and
`DecisionStatus` types. `ObjectFieldPathSchema`, `ObjectFieldIdentifierSchema`,
and `ObjectFieldTimestampSchema` expose the nested value constraints.

Custom application definitions opt in through `ObjectFieldsDefinition` with
`fieldsProfile: "common" | "adr"`, spreading the matching
`ObjectFieldsSchema.fields` or `ADRObjectFieldsSchema.fields` into their own
schema. Use the root application's `createMcpServer` or `registerObjectTools`.
Only opted-in types are advertised by the focused tools; the `"adr"` profile,
not the spelling of a type name, enables decisions. With no opted-in definition,
the application does not install the focused tools. Generic `ObjectDefinition`
has no profile and the generic MCP adapter does not interpret one.

The root and `/lib` `BaseObjectSchema` retain the generic library contract.
`/schemas` exports the application base with the optional common top-level
fields, and its ADR schema adds `decision`. Both keep metadata opaque.

The library's file-binding projection remains a generic graph/storage
capability. It reads the explicit top-level `fileBindings` field, validates
confined current files, and produces the derived model's `fileBindings` array.
It never interprets `metadata.fileBindings`.

## Compatibility

Old objects without the optional top-level fields remain valid. All existing
metadata is retained as opaque JSON, including legacy `reviewedHead`,
`decisionDate`, `execution`, and metadata keys that resemble the new fields.
There is no automatic promotion, fallback, repair, or bulk migration.

In particular, legacy `metadata.fileBindings` entries no longer create derived
file bindings. To restore those attachments, explicitly author and verify the
top-level `fileBindings` field in an authorized update. Nothing deletes the
legacy metadata value automatically. A top-level field and a same-named
metadata key may coexist without either altering the other.

The earlier application-only `Metadata*` wrappers and `metadataProfile` have
been replaced by the explicit field schemas/types and `fieldsProfile`; the
focused tool names likewise change from `objects_metadata_*` to
`objects_fields_*`. Update callers explicitly rather than assuming the old
operation now targets a different location.

Schema changes affect materialization fingerprints. Existing generated
snapshots must be checked and, when authorized, explicitly regenerated. A
successful read of an old snapshot does not establish current-schema freshness.
