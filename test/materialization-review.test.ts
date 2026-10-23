import { expect, test } from "bun:test";
import { mkdir, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import { expectedOutput } from "../src/lib/materialization/emit.ts";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { outputPlan } from "../src/lib/materialization/output.ts";
import { publish } from "../src/lib/materialization/publish.ts";
import { validationSnapshot } from "../src/lib/materialization/validate.ts";
import type { ObjectDefinition } from "../src/lib/types.ts";
import { definitions, fixture } from "./materialization-fixture.ts";

async function writeNote(root: string, id: string, relations: unknown) {
  const header = {
    id,
    name: id,
    title: id,
    description: "Plugin regression",
    tags: {},
    metadata: {},
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    retiredAt: null,
    relations,
  };
  await writeFile(
    path.join(root, "notes", `${id}.md`),
    `---\n${JSON.stringify(header)}\n---\nBody\n`,
  );
}

test("generic descriptor cardinality does not impose an undeclared single-container rule", async () => {
  const f = await fixture();
  try {
    const plugins: readonly ObjectDefinition[] = [
      {
        name: "note",
        directory: "notes",
        description: "Multiple containers allowed by schema",
        schema: Schema.Struct({
          ...BaseObjectSchema.fields,
          relations: Schema.Struct({ parents: Schema.Array(Schema.String) }),
        }),
        relations: [{ path: "parents", kind: "contains", targetType: "note", cardinality: "many" }],
      },
    ];
    await writeNote(f.vaultRoot, "a", { parents: ["b", "c"] });
    await writeNote(f.vaultRoot, "b", { parents: [] });
    await writeNote(f.vaultRoot, "c", { parents: [] });
    const result = await validateObjects({ ...f, definitions: plugins });
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.objects.find((object) => object.id === "a")?.references).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("plugin references use decoded relations while generated headers keep wire values", async () => {
  const f = await fixture();
  try {
    const plugins: readonly ObjectDefinition[] = [
      {
        name: "note",
        directory: "notes",
        description: "Transformed relation codec",
        schema: Schema.Struct({
          ...BaseObjectSchema.fields,
          relations: Schema.Struct({
            parent: Schema.NullOr(Schema.String),
            depends: Schema.fromJsonString(Schema.Array(Schema.String)),
          }),
        }),
        relations: definitions[0]?.relations ?? [],
      },
    ];
    await writeNote(f.vaultRoot, "a", { parent: null, depends: '["b"]' });
    await writeNote(f.vaultRoot, "b", { parent: null, depends: "[]" });
    const result = await validateObjects({ ...f, definitions: plugins });
    expect(result.diagnostics).toEqual([]);
    const object = result.objects.find((object) => object.id === "a");
    expect(object?.references.map((reference) => reference.target)).toEqual([
      { type: "note", id: "b" },
    ]);
    expect(object?.header.relations).toEqual({ parent: null, depends: '["b"]' });
  } finally {
    await f.close();
  }
});

for (const change of ["removed", "symlinked"] as const) {
  test(`publication refuses a ${change} binding after snapshot validation`, async () => {
    const f = await fixture();
    try {
      await mkdir(path.join(f.projectRoot, "src"));
      const bound = path.join(f.projectRoot, "src", "api.ts");
      await writeFile(bound, "export const api = 1;\n");
      await f.write("a", {
        metadata: {
          fileBindings: [{ root: "project", path: "src/api.ts", role: "implementation" }],
        },
      });
      const snapshot = await validationSnapshot(f);
      expect(snapshot.result.valid).toBe(true);
      if (!snapshot.registry) throw new Error("Expected registry");
      const expected = expectedOutput(
        snapshot.result,
        snapshot.registry,
        "@local/object-mcp/model",
      );
      const plan = await outputPlan(snapshot, expected, f);
      await unlink(bound);
      if (change === "symlinked") {
        await writeFile(path.join(f.projectRoot, "src", "other.ts"), "export {};\n");
        await symlink("other.ts", bound);
      }
      await expect(publish(snapshot, expected, plan, f)).rejects.toThrow("BINDING_CHANGED");
      await expect(readdir(f.outputDirectory)).rejects.toThrow();
    } finally {
      await f.close();
    }
  });
}

test("manifest records a deterministic generator release version", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    const result = await materializeObjects(f);
    expect(result.clean).toBe(true);
    expect(Reflect.get(result.manifest ?? {}, "generatorVersion")).toBe("0.1.0");
    expect((await materializeObjects({ ...f, check: true })).clean).toBe(true);
  } finally {
    await f.close();
  }
});
