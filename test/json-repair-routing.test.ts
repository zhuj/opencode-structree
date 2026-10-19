import { describe, expect, test } from "bun:test";
import { type JsonSchema, Schema } from "effect";
import { createInputRepairer, parseJson } from "../src/lib/json-repair";
import { FeatureSchema } from "../src/schemas";

const FeatureInput = Schema.Struct({
  object: FeatureSchema,
  body: Schema.optionalKey(Schema.String),
});

function featureBase() {
  return {
    id: "feature-id",
    name: "feature-name",
    title: "Feature title",
    description: "Feature description",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    retiredAt: null,
    tags: { project_id: "literal tag", "goal-name": "also literal" },
    metadata: { relations: { project: "metadata only", goals: "do not split, this" } },
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, other) => other !== index)).map((tail) => [value, ...tail]),
  );
}

describe("relaxed input routing", () => {
  test("rebuilds a missing object wrapper and nested commitments while preserving arbitrary maps", async () => {
    const base = featureBase();
    const { createdAt, updatedAt, retiredAt, ...rest } = base;
    const input = {
      ...rest,
      created_at: createdAt,
      updated_at: updatedAt,
      retired_at: retiredAt,
      project: "project-id",
      goals: ["goal-id"],
      body: "{this: 'is the literal Markdown body'}",
    };
    const original = structuredClone(input);
    const result = await parseJson(input, FeatureInput);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.errors));
    expect(result.data.object.relations).toEqual({
      project: "project-id",
      commitment: { goals: ["goal-id"] },
    });
    expect(result.data.object.createdAt).toEqual(new Date(createdAt));
    expect(result.data.object.tags).toEqual(base.tags);
    expect(result.data.object.metadata).toEqual(base.metadata);
    expect(result.data.body).toBe(input.body);
    expect(input).toEqual(original);
  });

  test("moves mixed owner and commitment fields to their unique enclosing destinations", async () => {
    const result = await parseJson(
      {
        object: {
          ...featureBase(),
          goals: ["goal-id"],
          relations: { commitment: { project: "project-id" } },
        },
      },
      FeatureInput,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.errors));
    expect(result.data.object.relations).toEqual({
      project: "project-id",
      commitment: { goals: ["goal-id"] },
    });
  });

  test("merges disjoint supplied fragments independently of input property order", async () => {
    const fragments: [string, unknown][] = [
      ["object", featureBase()],
      ["relations", { project: "project-id" }],
      ["goals", ["goal-id"]],
    ];
    for (const order of permutations(fragments)) {
      const result = await parseJson(Object.fromEntries(order), FeatureInput);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(JSON.stringify(result.errors));
      expect(result.data.object.relations).toEqual({
        project: "project-id",
        commitment: { goals: ["goal-id"] },
      });
    }
  });

  test("rejects duplicate destinations even when values agree and regardless of input order", async () => {
    const schema = Schema.Struct({ profile: Schema.Struct({ name: Schema.String }) });
    for (const aliasValue of ["original", "conflicting"]) {
      for (const order of permutations<[string, unknown]>([
        ["profile", { name: "original" }],
        ["profile_name", aliasValue],
      ])) {
        const result = await parseJson(Object.fromEntries(order), schema);
        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.errors.some((error) => error.code === "CONFLICTING_FIELDS")).toBe(true);
      }
    }
  });

  test("rejects parent scalars conflicting with supplied descendants in both orders", async () => {
    const schema = Schema.Struct({
      relations: Schema.NullOr(Schema.Struct({ partOf: Schema.NullOr(Schema.String) })),
    });
    for (const order of permutations<[string, unknown]>([
      ["relations", null],
      ["relations.partOf", "parent"],
    ])) {
      const result = await parseJson(Object.fromEntries(order), schema);
      expect(result.success).toBe(false);
      expect(result.errors.some((error) => error.code === "CONFLICTING_FIELDS")).toBe(true);
    }
  });

  test("requires explicit paths when distinct objects share an omitted leaf name", async () => {
    const schema = Schema.Struct({
      left: Schema.Struct({ name: Schema.String }),
      right: Schema.Struct({ name: Schema.String }),
    });
    const ambiguous = await parseJson({ name: "unknown destination" }, schema);
    expect(ambiguous.success).toBe(false);
    expect(ambiguous.errors.some((error) => error.code === "AMBIGUOUS_KEY")).toBe(true);
    const explicit = await parseJson({ "left.name": "left", right_name: "right" }, schema);
    expect(explicit.success).toBe(true);
    if (!explicit.success) throw new Error(JSON.stringify(explicit.errors));
    expect(explicit.data).toEqual({ left: { name: "left" }, right: { name: "right" } });
  });

  test("detects ambiguity between normalized direct names and concatenated nested paths", async () => {
    const schema = Schema.Struct({
      profileName: Schema.String,
      profile: Schema.Struct({ name: Schema.String }),
    });
    const result = await parseJson({ profile_name: "unknown destination" }, schema);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.code === "AMBIGUOUS_KEY")).toBe(true);
  });

  test("flattens conventional nested paths at several depths with fuzzy matching disabled", async () => {
    const one = await parseJson(
      { stage: { id: "stage-id" } },
      Schema.Struct({ stageId: Schema.String }),
      { fuzzyKeys: false },
    );
    expect(one.success).toBe(true);
    expect(one.data).toEqual({ stageId: "stage-id" });
    const many = await parseJson(
      { user: { profile: { name: "name", id: "id" } } },
      Schema.Struct({ userProfileName: Schema.String, userProfileId: Schema.String }),
      { fuzzyKeys: false },
    );
    expect(many.success).toBe(true);
    expect(many.data).toEqual({ userProfileName: "name", userProfileId: "id" });
  });

  test("accounts for every nested field when flattening rather than dropping unmatched siblings", async () => {
    const schema = Schema.Struct({ userProfileName: Schema.String });
    for (const profile of [
      { name: "name", secret: "must not disappear" },
      { name: "name", empty: {} },
      { name: "name", list: ["must not disappear"] },
    ]) {
      const result = await parseJson({ user: { profile } }, schema, { fuzzyKeys: false });
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.errors.some((error) => error.code === "UNKNOWN_KEY")).toBe(true);
    }
  });

  test("an enclosing canonical field takes precedence over a local fuzzy spelling guess", async () => {
    const schema = Schema.Struct({
      details: Schema.Struct({ value: Schema.String }),
      values: Schema.optionalKey(Schema.String),
    });
    const result = await parseJson({ details: { values: "must not become value" } }, schema);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.path === "/details/value")).toBe(true);
    const complete = await parseJson(
      { details: { value: "canonical", values: "enclosing field" } },
      schema,
    );
    expect(complete.success).toBe(true);
    expect(complete.data).toEqual({ details: { value: "canonical" }, values: "enclosing field" });
  });

  test("preserves identifier bytes, checksum strings and opaque data while wrapping one array value", async () => {
    const schema = Schema.Struct({
      id: Schema.String,
      expectedChecksum: Schema.String,
      relatesTo: Schema.Array(Schema.String),
      body: Schema.String,
      metadata: Schema.Record(Schema.String, Schema.Any),
    });
    const input = {
      id: " 001, two;\nthree ",
      expected_checksum: "0000123",
      relatesTo: "one,two;\nthree",
      body: "{broken JSON is valid Markdown}",
      metadata: { expected_checksum: "unchanged", enabled: "true", items: "a,b" },
    };
    const result = await parseJson(input, schema);
    expect(result.success).toBe(true);
    const { expected_checksum, ...unchanged } = input;
    expect(result.data).toEqual({
      ...unchanged,
      expectedChecksum: expected_checksum,
      relatesTo: [input.relatesTo],
    });
    expect(Object.hasOwn(result.data ?? {}, "expected_checksum")).toBe(false);
  });

  test("keeps array elements isolated and never routes a missing leaf across entries", async () => {
    const schema = Schema.Struct({
      items: Schema.Array(Schema.Struct({ name: Schema.String, id: Schema.String })),
    });
    const input = { items: [{ name: "first" }, { id: "second-id" }] };
    const original = structuredClone(input);
    const result = await parseJson(input, schema);
    expect(result.success).toBe(false);
    expect(input).toEqual(original);
    const complete = await parseJson(
      {
        items: [
          { NAME: "first", ID: "first-id" },
          { NAME: "second", ID: "second-id" },
        ],
      },
      schema,
    );
    expect(complete.success).toBe(true);
    expect(complete.data).toEqual({
      items: [
        { name: "first", id: "first-id" },
        { name: "second", id: "second-id" },
      ],
    });
  });

  test("does not synthesize missing required nullable values, arrays, or timestamps", async () => {
    const base = featureBase();
    for (const key of ["retiredAt", "createdAt", "updatedAt"] as const) {
      const object: Record<string, unknown> = {
        ...base,
        relations: { project: "project", commitment: { goals: [] } },
      };
      delete object[key];
      const result = await parseJson({ object }, FeatureInput);
      expect(result.success).toBe(false);
      expect(result.errors.some((error) => error.path === `/object/${key}`)).toBe(true);
    }
    const missingGoals = await parseJson(
      { object: { ...base, relations: { project: "project", commitment: {} } } },
      FeatureInput,
    );
    expect(missingGoals.success).toBe(false);
    expect(missingGoals.errors.some((error) => error.path.endsWith("/goals"))).toBe(true);
  });

  test("validates repaired unions strictly and rejects unknown fields and divergent candidates", async () => {
    const schema = Schema.Struct({
      payload: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("a"), value: Schema.Int }),
        Schema.Struct({ kind: Schema.Literal("b"), enabled: Schema.Boolean }),
      ]),
    });
    const repaired = await parseJson({ payload: { kind: "A", VALUE: "4" } }, schema);
    expect(repaired.success).toBe(true);
    expect(repaired.data).toEqual({ payload: { kind: "a", value: 4 } });
    const extra = await parseJson(
      { payload: { kind: "A", VALUE: "4", secret: "must not disappear" } },
      schema,
    );
    expect(extra.success).toBe(false);
    expect(extra.data).toBeNull();
    const ambiguous = await parseJson(
      { payload: { mode: "true" } },
      Schema.Struct({
        payload: Schema.Union([
          Schema.Struct({ mode: Schema.Boolean }),
          Schema.Struct({ mode: Schema.Literal("TRUE") }),
        ]),
      }),
    );
    expect(ambiguous.success).toBe(false);
    expect(ambiguous.errors.some((error) => error.code === "AMBIGUOUS_UNION")).toBe(true);
  });

  test("preserves resource-limit failures while exploring recursive union alternatives", () => {
    const branch = () => ({
      type: "object",
      properties: { next: { $ref: "#/$defs/Node" } },
      required: ["next"],
      additionalProperties: false,
    });
    const document: JsonSchema.Document<"draft-2020-12"> = {
      dialect: "draft-2020-12",
      schema: { $ref: "#/$defs/Node" },
      definitions: { Node: { anyOf: [branch(), branch()] } },
    };
    let input: Record<string, unknown> = { bad: 1 };
    for (let depth = 0; depth < 12; depth++) input = { next: input };
    const result = createInputRepairer(document, { maxNodes: 64, maxDepth: 32, maxRepairs: 2 })(
      input,
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.code === "RESOURCE_LIMIT")).toBe(true);
  });
});
