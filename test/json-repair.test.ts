import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { parseJson } from "../src/lib/json-repair/index.ts";
import { ProjectSchema, ScenarioSchema } from "../src/schemas/index.ts";

function base() {
  return {
    id: "s-1",
    name: "design",
    title: "Architecture",
    description: "A complete scenario",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    retiredAt: null,
    tags: { created_at: "preserve spelling", Project: "preserve case" },
    metadata: { relations: { commitment_goals: "opaque text" }, count: "12" },
  };
}

describe("Effect validated relaxed parser", () => {
  test("valid values use the original codec without rewriting maps or strings", async () => {
    const input = { ...base(), relations: { partOf: null } };
    const before = structuredClone(input);
    const parsed = await parseJson(input, ProjectSchema);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.data.createdAt).toBeInstanceOf(Date);
    expect(parsed.data.tags).toEqual(input.tags);
    expect(parsed.data.metadata).toEqual(input.metadata);
    expect(parsed.repairs).toEqual([]);
    expect(input).toEqual(before);
  });

  test("recovers full object and relationship wrappers with all required fields supplied", async () => {
    const input = {
      ...base(),
      project: "p-1",
      part_of: null,
      depends_on: ["s-0"],
      features: ["f-1", "f-2"],
      body: "# Keep this {exact: 'Markdown'}\n",
    };
    const parsed = await parseJson(
      input,
      Schema.Struct({ object: ScenarioSchema, body: Schema.String }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.data.object.relations).toEqual({
      project: "p-1",
      partOf: null,
      dependsOn: ["s-0"],
      commitment: { features: ["f-1", "f-2"] },
    });
    expect(parsed.data.body).toBe(input.body);
    expect(parsed.data.object.metadata).toEqual(input.metadata);
    expect(
      parsed.repairs.some((repair) => repair.path === "/object/relations/commitment/features"),
    ).toBe(true);
  });

  test("moves misplaced fields out of a relation container without copying existing values", async () => {
    const { title, ...rest } = base();
    const input = {
      ...rest,
      relations: { title, project: "p-1", partOf: null, dependsOn: [], features: [] },
    };
    const parsed = await parseJson(input, ScenarioSchema);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.data.title).toBe(title);
    expect(parsed.data.relations.commitment.features).toEqual([]);
    expect(parsed.repairs).toContainEqual(
      expect.objectContaining({ from: "/relations/title", path: "/title" }),
    );
    expect(input.relations.title).toBe(title);
  });

  test("parses relaxed text, applies key repair, and then rejects schema refinements", async () => {
    const schema = Schema.Struct({ count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) });
    const accepted = await parseJson("```json\n{Count: '3',}\n```", schema);
    expect(accepted).toMatchObject({ success: true, data: { count: 3 } });
    for (const count of ["-1", "1.4", "3 items", "9007199254740993", "0x10"]) {
      const rejected = await parseJson({ Count: count }, schema);
      expect(rejected.success).toBe(false);
      expect(rejected.data).toBeNull();
      expect(rejected.errors.some((error) => error.code === "SCHEMA_MISMATCH")).toBe(true);
    }
  });

  test("leaves encoded transforms to Effect rather than coercing their domain type", async () => {
    const schema = Schema.Struct({ value: Schema.NumberFromString, at: Schema.Date });
    const parsed = await parseJson({ Value: "12.5", AT: "2026-10-19T00:00:00Z" }, schema);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.data.value).toBe(12.5);
    expect(parsed.data.at).toBeInstanceOf(Date);
    expect(parsed.repairs.every((repair) => repair.category === "key-rename")).toBe(true);
  });

  test("awaits asynchronous Effect decoding before returning a repaired domain value", async () => {
    let completed = 0;
    const checked = Schema.String.pipe(
      Schema.middlewareDecoding((decoding) =>
        Effect.tap(decoding, () =>
          Effect.promise(async () => {
            await Promise.resolve();
            completed++;
          }),
        ),
      ),
    );
    const parsed = await parseJson({ Label: "asynchronous" }, Schema.Struct({ label: checked }));
    expect(parsed).toMatchObject({ success: true, data: { label: "asynchronous" } });
    expect(completed).toBeGreaterThan(0);
  });

  test("never invents missing required nullable values, arrays, or dates", async () => {
    const complete = {
      ...base(),
      relations: { project: "p-1", partOf: null, dependsOn: [], commitment: { features: [] } },
    };
    for (const input of [
      { ...complete, retiredAt: "null" },
      { ...complete, createdAt: "someday" },
      { ...complete, relations: { project: "p-1", partOf: null, commitment: { features: [] } } },
      { ...complete, relations: { project: "p-1", dependsOn: [], commitment: { features: [] } } },
      { ...complete, relations: { project: "p-1", partOf: null, dependsOn: [] } },
    ]) {
      const parsed = await parseJson(input, ScenarioSchema);
      expect(parsed.success).toBe(false);
      expect(parsed.data).toBeNull();
    }
  });

  test("array splitting is opt-in, keeps empty members, and has a bounded allocation", async () => {
    const schema = Schema.Struct({ ids: Schema.Array(Schema.String) });
    expect(await parseJson({ ids: "part,of;one\nidentifier" }, schema)).toMatchObject({
      success: true,
      data: { ids: ["part,of;one\nidentifier"] },
    });
    expect(await parseJson({ ids: "a, b;" }, schema, { splitArrays: true })).toMatchObject({
      success: true,
      data: { ids: ["a", "b", ""] },
    });
    const limited = await parseJson({ ids: ",".repeat(10_000) }, schema, {
      splitArrays: true,
      maxNodes: 10,
    });
    expect(limited.success).toBe(false);
    expect(limited.errors.some((error) => error.code === "RESOURCE_LIMIT")).toBe(true);
    expect(await parseJson({ ids: "a" }, schema, { inferWrappers: false })).toMatchObject({
      success: false,
      data: null,
    });
  });

  test("recovers only one unambiguous enum representation and preserves ordinary string values", async () => {
    const schema = Schema.Struct({
      mode: Schema.Literals(["fulltext", "semantic"]),
      id: Schema.String,
      enabled: Schema.Boolean,
    });
    expect(
      await parseJson({ mode: "FULLTEXT", id: " ABC ", enabled: "false" }, schema),
    ).toMatchObject({ success: true, data: { mode: "fulltext", id: " ABC ", enabled: false } });
    for (const bad of [
      { mode: "fulltxt", id: "ABC", enabled: "true" },
      { mode: "fulltext", id: 12, enabled: true },
      { mode: "fulltext", id: "ABC", enabled: "yes" },
    ])
      expect((await parseJson(bad, schema)).success).toBe(false);
    const ambiguous = Schema.Struct({ mode: Schema.Literals(["A_B", "a-b"]) });
    expect((await parseJson({ mode: "a b" }, ambiguous)).success).toBe(false);
  });
});
