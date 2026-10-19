# Relaxed JSON and MCP arguments

Generated MCP tools repair unambiguous argument mistakes before invoking the object facade. The parser can recognize a misspelled field, reconstruct omitted nesting, decode stringified JSON containers, and convert selected scalar representations. The original Effect schema must validate the complete result before any tool handler runs.

This is an Effect adaptation of the supplied JSON repair modules. It adds `jsonrepair` for syntax repair and no Zod runtime dependency. Domain schemas, JSON codecs, required fields, and the canonical schemas advertised by `tools/list` still come from Effect.

## The MCP boundary

The official MCP SDK first decodes the protocol message. For each generated tool, its Standard Schema input validator then:

1. Checks the parsed arguments against the configured byte, depth, node, and property-safety limits.
2. Validates them with the strict Effect JSON codec. Already valid arguments do not enter structural repair.
3. If validation failed and repair is enabled, constructs one candidate using the schema's declared fields and containers.
4. Validates that candidate with the same strict Effect codec, including its constraints and Date decoding.

The handler receives validated domain values, including `Date` objects where the schema requires them. Tool outputs continue through the strict output bridge. The exported `effectMcpSchema` helper also retains strict behavior for host-defined tools; registering object tools does not change an existing host's other tools.

Repair applies to generated MCP arguments. Filesystem reads, YAML parsing, direct facade calls, registry validation, and configuration files retain their existing validation behavior.

## A mixed-field example

An LLM may place a relation collection one level too high and use a different key convention. These `feature_create` arguments are accepted:

```json
{
  "object": {
    "id": "feature-search",
    "name": "object-search",
    "title": "Search objects",
    "description": "Find relevant architecture objects",
    "created_at": "2026-10-19T09:00:00.000Z",
    "updatedAt": "2026-10-19T09:00:00.000Z",
    "retiredAt": null,
    "tags": { "review_status": "pending" },
    "metadata": { "created_at": "This application key stays unchanged" },
    "relations": {
      "project": "project-main",
      "commitment_goals": ["goal-discovery"]
    }
  },
  "body": "# Search behavior\n"
}
```

The canonical destinations are `object.createdAt` and `object.relations.commitment.goals`. Metadata and tag keys remain exactly as supplied. The body is ordinary Markdown, even if it happens to resemble JSON.

The parser can also infer an omitted `object` wrapper on a create call when the supplied fields have unique destinations. For example, a complete Project's fields can appear alongside the tool's `body`. For update calls, the tool's outer `id` and `object.id` must both be supplied; the parser never copies one field to manufacture the other.

These examples describe argument objects within a valid MCP request. A stringified relation such as `"relations": "{partOf: null,}"` can be decoded and repaired because Effect identifies that field as an object container.

## Accepted repairs

| Mechanism | Behavior and limits |
| --- | --- |
| Key spelling | Exact names take priority. Case and conventional underscore, hyphen, and whitespace variations can match a declared name. Bounded Levenshtein matching handles sufficiently close longer keys. |
| Field placement | Dotted or joined field paths can resolve to declared nested fields. Misplaced fields can move to a unique destination in the enclosing schema. Disjoint supplied fragments may form the same parent object. |
| Missing wrappers | A missing object container may be reconstructed from declared fields. A scalar can become a one-element array when an array is required. A scalar can fill an object wrapper only when that object has one declared field. |
| Stringified containers | Strings that look like JSON can be decoded where an object or array is required. Ordinary string fields are left as strings. |
| Syntax | The guarded syntax layer supports such mistakes as unquoted keys, single-quoted strings, trailing commas, comments, complete Markdown code fences, and certain missing delimiters or outer braces. A repair must preserve the supplied scalar tokens. |
| Numbers | Numeric strings can become finite numbers. Integer schemas require safe integers; fractional values are never rounded. Incomplete numbers, unsafe integer conversions, and strings such as `"01"` are not converted. |
| Booleans | Strings spelling `true` or `false`, allowing case and surrounding whitespace, can become booleans. `yes`, `no`, `1`, and `0` are not boolean synonyms. |
| Literal strings/enums | Case and conventional separator normalization can select one declared literal. The parser does not use edit-distance guessing to change enum values. |
| Delimited arrays | Opt-in only. With `splitArrays: true`, comma, semicolon, or newline delimiters split a string into array elements and trim each element. There is no CSV quoting language. |

By default, a string such as `"a,b"` supplied for a string array becomes `["a,b"]` when wrapper inference is enabled. It becomes `["a", "b"]` only if delimiter splitting is explicitly enabled. Keep splitting disabled when delimiters may belong to identifiers.

Key matching confidence is a heuristic score, not a probability of the model's intent. `minConfidence` and `maxKeyDistance` control edit-distance matching; exact, case, and separator matches remain available when `fuzzyKeys` is false. Set `enabled: false` to require canonical arguments throughout.

## Rejected or preserved inputs

Multiple routes to different canonical fields are ambiguous and fail. Two supplied fields addressing the same destination also fail, even if their values are equal. For example, supplying both `createdAt` and `created_at`, or both `expectedChecksum` and `expected_checksum`, does not select a winner by property order. A supplied parent value cannot be overwritten by a nested fragment.

Unknown fields are not dropped. Missing required values are not invented. The core schema contract therefore remains exact:

- `retiredAt` and nullable `partOf` fields require an explicit value, including explicit `null` where applicable.
- Required arrays and nested `commitment` structures must contain the caller's supplied values. Omitted arrays do not become empty arrays.
- Required owner references remain required: for example, Feature's `relations.project` and ScenarioAcceptanceCriteria's `relations.scenario`.
- There is no `belongsTo` field, `Feature.partOf`, or separate Acceptance entity.
- Update remains a complete replacement. IDs and `createdAt` remain immutable, and update/delete still require the current checksum.

String values are not fuzzy-corrected, trimmed, or converted from numbers to satisfy an ID or checksum field. Names, descriptions, relation IDs, query text, and Markdown body strings retain their supplied contents. Date strings must still pass the Effect codec; the parser does not invent or repair timestamps.

Arbitrary record contents, including `metadata` and `tags`, are opaque to structural repair. Their application-defined keys are not treated as schema aliases or moved into relationships. They must still satisfy the original schema and JSON safety rules. The reserved property names `__proto__`, `prototype`, and `constructor` are rejected everywhere, including inside `metadata` and `tags`. Other map keys and contents are preserved. Proxies, accessors/getters, cycles, class instances, nonfinite numbers, and other non-JSON values are also rejected, including by the programmatic parser.

An ambiguous, incomplete, unsafe, over-budget, or schema-invalid argument produces an MCP tool error before the facade is invoked. Parser failure results contain `data: null`; they do not expose a partial object for writing.

## Repair reports

An accepted repaired call includes its report outside `structuredContent`:

```ts
const response = await client.callTool({
  name: "objects_search",
  arguments: { query: "search architecture", top_n: "3" },
});

const report = response._meta?.["object-mcp/input-repair"];
```

The report has this shape:

```ts
{
  repairs: [
    {
      path: "/topN",
      from: "/top_n",
      category: "key-rename",
      message: "Mapped a supplied field to its unique schema destination.",
      confidence: 0.95,
    },
    // A separate notice describes the string-to-number conversion.
  ],
}
```

`path` and optional `from` are JSON Pointers. The empty pointer addresses the root. Notice categories are `key-rename`, `structural-repair`, `type-coercion`, `wrapper-inferred`, `array-split`, and `syntax-repair`. Notices include paths and descriptions rather than copies of supplied field values.

Reports follow the decoded arguments for one invocation. Concurrent calls cannot exchange reports, and a later canonical call has no repair report. A facade error after successful argument repair, such as a checksum conflict, still carries that invocation's notices. Validation failures do not call the handler or return a successfully repaired object.

## Configuration and embedded use

Repair is enabled by default. Partial `mcp.inputRepair` sections merge with the same defaults used by the standalone parser:

```json
{
  "mcp": {
    "inputRepair": {
      "enabled": true,
      "syntax": true,
      "fuzzyKeys": true,
      "coerceTypes": true,
      "inferWrappers": true,
      "splitArrays": false,
      "minConfidence": 0.8,
      "maxKeyDistance": 2,
      "maxInputBytes": 5000000,
      "maxDepth": 32,
      "maxNodes": 50000,
      "maxRepairs": 100
    }
  }
}
```

For parsed inputs, the byte budget covers their compact JSON representation, including string escaping. Text parsing also checks the source and repaired JSON text. This budget is separate from `sync.maxFileBytes`, which measures the source file. Depth, node, and byte checks also apply in strict mode. Routing has an additional bounded work budget. `maxDepth` cannot exceed 128, and `maxKeyDistance` is limited to 0–3. See [the configuration reference](configuration.md#mcp-input-repair) for every setting.

The CLI uses the loaded configuration. A framework passed to `registerObjectTools` or `createMcpServer` supplies its `config.mcp` automatically. An explicit third argument overrides individual fields:

```ts
import { createMcpServer, registerObjectTools } from "@local/object-mcp";

registerObjectTools(existingServer, framework, {
  inputRepair: { enabled: false },
});

// Alternatively, create a server with explicit repair limits:
const server = createMcpServer(framework, { name: "my-plugin", version: "1.0.0" }, {
  inputRepair: { minConfidence: 0.9, maxRepairs: 25 },
});
```

These are alternative registration examples. The caller owns the facade's lifetime. A custom facade without configuration uses the defaults, subject to the explicit options. Malformed host repair options are rejected. The `syntax`, `coerceTypes`, and `inferWrappers` flags can disable those mechanisms independently; `splitArrays` remains independent and opt-in.

## Standalone Effect parser

`parseJson` is asynchronous and requires an Effect schema. It accepts JSON text or an already parsed object and returns either a fully decoded value or errors:

```ts
import { Schema } from "effect";
import { parseJson } from "@local/object-mcp/json-repair";

const SearchOptionsSchema = Schema.Struct({
  query: Schema.NonEmptyString,
  options: Schema.Struct({
    topN: Schema.Int,
    includeBody: Schema.Boolean,
  }),
});

const result = await parseJson(
  `{
    query: "Architecture decisions",
    options_top_n: "3",
    options_include_body: "false",
  }`,
  SearchOptionsSchema,
);

if (result.success) {
  console.log(result.data);
  // { query: "Architecture decisions", options: { topN: 3, includeBody: false } }
  console.log(result.repairs);
} else {
  console.error(result.errors);
  // result.data is null.
}
```

Decoded output follows the schema's domain type. A `Schema.Date` field becomes a `Date` after a valid ISO string is decoded. Asynchronous schema checks and transformations are awaited. Required keys and constraints remain the original schema's responsibility.

For already parsed inputs, strict validation runs before repair. For text input, the syntax layer first parses the text, then the same validation and repair sequence applies. With `enabled: false`, valid JSON text is still parsed, but syntax or schema repairs are rejected. Invalid parser options throw a configuration error; ordinary parsing/validation failures return the failure result.

The lower-level `repairInput(input, document, options)` and `createInputRepairer(document, options)` use an Effect-generated JSON Schema document. The latter compiles the routing shape once for repeated calls. Their `RepairResult.success` means only that candidate construction completed: **the candidate must still pass the original Effect codec**. Refinements and transformations cannot be established by the structural JSON Schema adapter alone. Prefer `parseJson` for direct application use. `inspectInput` and `parseJsonText` are also exported for callers building an explicit boundary.

## Adoption and transport limits

| Supplied module mechanism | Adaptation in this framework |
| --- | --- |
| Schema adapter | `schema-adapter.ts` derives a repair shape from Effect's canonical JSON Schema, including references and supported union/container shapes. |
| Key matching and name mapping | `key-matcher.ts` and `name-mapper.ts` provide bounded matching and unique destination routing, with ambiguity and collision errors. |
| Coercion and wrapper inference | `pipeline.ts` applies conservative conversions and wrapper inference according to the destination schema. |
| Syntax/fallback parsing | `syntax.ts` combines guarded token scanning with `jsonrepair`, detects duplicate keys before parsing, and rejects repairs that discard or invent scalar tokens. |
| Property safety | `property-safety.ts` checks plain JSON values and resource budgets without invoking getters or `toJSON`. |
| Pipeline and result types | The public async Effect parser performs final codec validation and returns typed success/failure results. The MCP boundary adds per-invocation reports. |

The supplied parser's general default-filling, value dropping, and fuzzy enum guesses are not part of the write boundary. Structural recovery must still yield exactly the object required by the original schema.

This boundary cannot repair malformed outer JSON-RPC messages that the MCP SDK rejects before tool validation. It also cannot detect duplicate keys that an upstream decoder has already collapsed into an object. Duplicate keys are detected when this parser receives raw JSON text itself, including stringified containers inside otherwise valid MCP arguments. It never rewrites protocol envelopes, methods, tool names, or request IDs.

Implementation: [MCP boundary](../src/lib/mcp-input.ts), [tool integration](../src/lib/mcp.ts), [parser pipeline](../src/lib/json-repair/pipeline.ts), [syntax guards](../src/lib/json-repair/syntax.ts), and [repair options](../src/lib/json-repair/types.ts).
