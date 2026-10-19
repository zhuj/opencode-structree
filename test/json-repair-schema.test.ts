import { describe, expect, test } from "bun:test";
import { type JsonSchema, Schema } from "effect";
import { levenshteinDistance, matchKey, normalizeKey } from "../src/lib/json-repair/key-matcher";
import {
  jsonSchemaToRepairShape,
  type RepairShape,
  resolveRepairShape,
} from "../src/lib/json-repair/schema-adapter";
import { createCoreRegistry } from "../src/registry";
import { FeatureSchema, ProjectSchema } from "../src/schemas";

function shape<S extends Schema.ConstraintDecoder<unknown>>(schema: S): RepairShape {
  return jsonSchemaToRepairShape(
    Schema.toJsonSchemaDocument(Schema.toCodecJson(schema), { onExcessProperty: "error" }),
  );
}

function objectShape(input: RepairShape): Extract<RepairShape, { kind: "object" }> {
  const value = resolveRepairShape(input);
  if (value.kind !== "object") throw new Error(`Expected object repair shape, got ${value.kind}`);
  return value;
}

function document(
  schema: JsonSchema.JsonSchema,
  definitions: JsonSchema.Definitions = {},
): JsonSchema.Document<"draft-2020-12"> {
  return { dialect: "draft-2020-12", schema, definitions };
}

describe("Effect JSON repair shapes", () => {
  test("preserves required nullable fields and leaves tag and metadata maps opaque", () => {
    const project = objectShape(shape(ProjectSchema));
    expect(project.additionalProperties).toBe(false);
    for (const property of Object.values(project.properties)) expect(property.optional).toBe(false);
    expect(resolveRepairShape(project.properties.createdAt!.shape)).toEqual({
      kind: "scalar",
      type: "string",
    });
    expect(resolveRepairShape(project.properties.retiredAt!.shape)).toEqual({
      kind: "union",
      variants: [
        { kind: "scalar", type: "string" },
        { kind: "scalar", type: "null" },
      ],
    });
    expect(project.properties.tags!.shape).toEqual({ kind: "opaque" });
    expect(project.properties.metadata!.shape).toEqual({ kind: "opaque" });
    const relations = objectShape(project.properties.relations!.shape);
    expect(Object.keys(relations.properties)).toEqual(["partOf"]);
    expect(relations.properties.partOf!.optional).toBe(false);
    const feature = objectShape(shape(FeatureSchema));
    const featureRelations = objectShape(feature.properties.relations!.shape);
    expect(Object.keys(featureRelations.properties)).toEqual(["project", "commitment"]);
    const commitment = objectShape(featureRelations.properties.commitment!.shape);
    expect(commitment.properties.goals).toEqual({
      shape: { kind: "array", items: { kind: "scalar", type: "string" } },
      optional: false,
    });
  });

  test("derives every registered entity from the same canonical wire schema", () => {
    const registry = createCoreRegistry();
    for (const definition of registry.definitions) {
      const source = registry.jsonSchema(definition.name);
      const adapted = objectShape(shape(definition.schema));
      expect(Object.keys(adapted.properties)).toEqual(Object.keys(source.properties as object));
      expect(
        Object.keys(adapted.properties).filter((key) => !adapted.properties[key]!.optional),
      ).toEqual(source.required as string[]);
      expect(adapted.additionalProperties).toBe(false);
    }
  });

  test("distinguishes optional fields from nullable fields and ignores annotation defaults", () => {
    const adapted = objectShape(
      shape(
        Schema.Struct({
          requiredNull: Schema.NullOr(Schema.String),
          optionalText: Schema.optionalKey(Schema.String),
          optionalNull: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    );
    expect(adapted.properties.requiredNull!.optional).toBe(false);
    expect(adapted.properties.optionalText!.optional).toBe(true);
    expect(adapted.properties.optionalNull!.optional).toBe(true);
    const withDefault = objectShape(
      jsonSchemaToRepairShape(
        document({
          type: "object",
          properties: { required: { type: "string", default: "never invent this" } },
          required: ["required"],
          additionalProperties: false,
        }),
      ),
    );
    expect(withDefault.properties.required).toEqual({
      shape: { kind: "scalar", type: "string" },
      optional: false,
    });
  });

  test("uses encoded scalar types and retains literal and union alternatives", () => {
    expect(shape(Schema.NumberFromString)).toEqual({ kind: "scalar", type: "string" });
    expect(shape(Schema.Date)).toEqual({ kind: "scalar", type: "string" });
    expect(shape(Schema.Int)).toEqual({ kind: "scalar", type: "integer" });
    expect(shape(Schema.Boolean)).toEqual({ kind: "scalar", type: "boolean" });
    expect(shape(Schema.Literals(["fulltext", "semantic", "hybrid"]))).toEqual({
      kind: "literal",
      values: ["fulltext", "semantic", "hybrid"],
    });
    expect(jsonSchemaToRepairShape(document({ type: ["boolean", "null"] }))).toEqual({
      kind: "union",
      variants: [
        { kind: "scalar", type: "boolean" },
        { kind: "scalar", type: "null" },
      ],
    });
    expect(jsonSchemaToRepairShape(document({ const: 17 }))).toEqual({
      kind: "literal",
      values: [17],
    });
    expect(
      jsonSchemaToRepairShape(document({ oneOf: [{ const: true }, { const: null }] })),
    ).toEqual({
      kind: "union",
      variants: [
        { kind: "literal", values: [true] },
        { kind: "literal", values: [null] },
      ],
    });
  });

  test("keeps arbitrary maps and unsupported compositions opaque", () => {
    for (const schema of [
      {},
      { type: "object", additionalProperties: { type: "number" } },
      {
        type: "object",
        patternProperties: { "^tag_": { type: "string" } },
        additionalProperties: false,
      },
      { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }] },
      { allOf: [{ type: "object", properties: { name: { type: "string" } } }] },
      // biome-ignore lint/suspicious/noThenProperty: This JSON Schema keyword is data, not a thenable callback.
      { if: { type: "string" }, then: { minLength: 2 } },
      { const: { name: "literal objects are not wrappers" } },
    ]) {
      expect(jsonSchemaToRepairShape(document(schema))).toEqual({ kind: "opaque" });
    }
    const open = objectShape(
      jsonSchemaToRepairShape(
        document({
          type: "object",
          properties: { known: { type: "string" } },
          additionalProperties: { type: "string" },
        }),
      ),
    );
    expect(open.additionalProperties).toBe(true);
    expect(Object.keys(open.properties)).toEqual(["known"]);
    expect(shape(Schema.Struct({}))).toEqual({ kind: "opaque" });
    expect(
      jsonSchemaToRepairShape(document({ type: "object", additionalProperties: false })),
    ).toEqual({
      kind: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(shape(Schema.Never)).toEqual({ kind: "never" });
    expect(jsonSchemaToRepairShape(document({ type: "array", items: false }))).toEqual({
      kind: "array",
      items: { kind: "never" },
    });
  });

  test("resolves recursive Effect refs without expanding infinitely or omitting child fields", () => {
    interface Node {
      readonly name: string;
      readonly children: readonly Node[];
    }
    const NodeSchema: Schema.Codec<Node> = Schema.suspend(() =>
      Schema.Struct({ name: Schema.String, children: Schema.Array(NodeSchema) }),
    ).annotate({ identifier: "RepairNode" });
    const node = objectShape(shape(NodeSchema));
    const children = resolveRepairShape(node.properties.children!.shape);
    expect(children.kind).toBe("array");
    if (children.kind !== "array") throw new Error("Expected child array");
    expect(resolveRepairShape(children.items)).toBe(node);
    const childNode = objectShape(children.items);
    expect(childNode.properties.name!.optional).toBe(false);
    expect(resolveRepairShape(childNode.properties.name!.shape)).toEqual({
      kind: "scalar",
      type: "string",
    });
  });

  test("resolves escaped local pointers and leaves missing, inherited, external and cyclic refs opaque", () => {
    expect(
      jsonSchemaToRepairShape(
        document({ $ref: "#/$defs/A~1B~0C%20D" }, { "A/B~C D": { type: "integer" } }),
      ),
    ).toEqual({ kind: "scalar", type: "integer" });
    expect(
      jsonSchemaToRepairShape(
        document({
          $ref: "#/properties/name",
          properties: { name: { type: "string" } },
        }),
      ),
    ).toEqual({ kind: "scalar", type: "string" });
    for (const ref of [
      "#/$defs/missing",
      "#/$defs/toString",
      "https://example.org/schema",
      "#/%ZZ",
    ]) {
      expect(resolveRepairShape(jsonSchemaToRepairShape(document({ $ref: ref })))).toEqual({
        kind: "opaque",
      });
    }
    const aliases = jsonSchemaToRepairShape(
      document({ $ref: "#/$defs/A" }, { A: { $ref: "#/$defs/B" }, B: { $ref: "#/$defs/A" } }),
    );
    expect(resolveRepairShape(aliases)).toEqual({ kind: "opaque" });
  });

  test("caps unusually deep schema traversal and does not expose object prototype properties", () => {
    let nested: JsonSchema.JsonSchema = { type: "string" };
    for (let depth = 0; depth < 2_000; depth++) nested = { type: "array", items: nested };
    let adapted = jsonSchemaToRepairShape(document(nested));
    let depth = 0;
    while (adapted.kind === "array") {
      depth++;
      adapted = adapted.items;
    }
    expect(depth).toBeLessThanOrEqual(129);
    expect(adapted).toEqual({ kind: "opaque" });
    const empty = objectShape(
      jsonSchemaToRepairShape(document({ type: "object", additionalProperties: false })),
    );
    expect(Object.getPrototypeOf(empty.properties)).toBeNull();
    expect(empty.properties.toString).toBeUndefined();
    const dangerousName = objectShape(
      jsonSchemaToRepairShape(
        document(
          JSON.parse(
            '{"type":"object","properties":{"__proto__":{"type":"string"}},"additionalProperties":false}',
          ),
        ),
      ),
    );
    expect(Object.getPrototypeOf(dangerousName.properties)).toBeNull();
    expect(Object.hasOwn(dangerousName.properties, "__proto__")).toBe(true);
  });
});

describe("deterministic key matching", () => {
  test("prefers canonical spelling and supports conventional case and word separators", () => {
    expect(matchKey("partOf", ["PartOf", "partOf"])).toEqual({
      kind: "match",
      key: "partOf",
      strategy: "exact",
      confidence: 1,
    });
    expect(matchKey("PARTOF", ["partOf"])).toEqual({
      kind: "match",
      key: "partOf",
      strategy: "case-insensitive",
      confidence: 0.98,
    });
    for (const alias of ["part_of", "part-of", "PART OF"]) {
      expect(matchKey(alias, ["partOf"])).toEqual({
        kind: "match",
        key: "partOf",
        strategy: "normalized",
        confidence: 0.95,
      });
    }
    expect(normalizeKey("über_Count")).toBe("übercount");
    expect(normalizeKey("relations.partOf")).toBe("relations.partof");
  });

  test("reports every best candidate independently of declaration order", () => {
    const sets = [
      { input: "NAME", keys: ["Name", "name"], strategy: "case-insensitive" },
      { input: "part-of", keys: ["partOf", "part_of"], strategy: "normalized" },
      { input: "parcs", keys: ["parts", "parks"], strategy: "levenshtein" },
    ] as const;
    for (const { input, keys, strategy } of sets) {
      const forward = matchKey(input, keys);
      expect(forward.kind).toBe("ambiguous");
      if (forward.kind !== "ambiguous") throw new Error("Expected ambiguity");
      expect(forward.strategy).toBe(strategy);
      expect(forward.candidates).toEqual([...keys].sort());
      expect(matchKey(input, [...keys].reverse())).toEqual(forward);
    }
    expect(matchKey("Part_Of", ["partOf", "partOf"]).kind).toBe("match");
  });

  test("accepts strong edit matches while rejecting weak prefixes and short identifier guesses", () => {
    const description = matchKey("descrption", ["relations", "description", "title"]);
    expect(description.kind).toBe("match");
    if (description.kind !== "match") throw new Error("Expected a spelling repair");
    expect(description.key).toBe("description");
    expect(description.strategy).toBe("levenshtein");
    expect(description.confidence).toBeCloseTo(1 - 1 / 11);
    expect(matchKey("jd", ["id"])).toEqual({ kind: "none" });
    expect(matchKey("ids", ["id"])).toEqual({ kind: "none" });
    expect(matchKey("proj", ["project"])).toEqual({ kind: "none" });
    expect(matchKey("desc", ["description"], { maxDistance: 8 })).toEqual({ kind: "none" });
    expect(matchKey("descrption", ["description"], { minConfidence: 0.99 })).toEqual({
      kind: "none",
    });
    expect(matchKey("descrption", ["description"], { maxDistance: 0 })).toEqual({ kind: "none" });
    expect(matchKey("descrption", ["description"], { fuzzy: false })).toEqual({ kind: "none" });
    expect(matchKey("created_at", ["createdAt"], { fuzzy: false }).kind).toBe("match");
    expect(matchKey("a".repeat(129), [`${"a".repeat(128)}b`])).toEqual({ kind: "none" });
  });

  test("calculates insertion, deletion, substitution and transposition distances without greedy exits", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("same", "same")).toBe(0);
    expect(levenshteinDistance("form", "from")).toBe(2);
    expect(matchKey("named", ["namers", "names"])).toEqual({
      kind: "match",
      key: "names",
      strategy: "levenshtein",
      confidence: 0.8,
    });
  });
});
