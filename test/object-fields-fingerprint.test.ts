import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import { materializeObjects } from "../src/lib/materialization/index.ts";
import { ObjectFieldsSchema } from "../src/object-fields/schemas.ts";
import { coreDefinitions } from "../src/registry.ts";
import { ProjectSchema } from "../src/structree/schemas/index.ts";
import { fixture } from "./materialization-fixture.ts";

test("moving reserved metadata to top-level fields invalidates snapshots until explicit regeneration", async () => {
  const f = await fixture();
  try {
    const project = coreDefinitions.find((definition) => definition.name === "project");
    if (project === undefined) throw new Error("Missing project definition.");
    const {
      fileBindings: _bindings,
      evidences: _evidences,
      reviews: _reviews,
      ...oldFields
    } = ProjectSchema.fields;
    const oldDefinition = {
      ...project,
      schema: Schema.Struct({
        ...oldFields,
        metadata: Schema.StructWithRest(ObjectFieldsSchema, [
          Schema.Record(Schema.String, Schema.Unknown),
        ]),
      }),
    };
    const original = await materializeObjects({ ...f, definitions: [oldDefinition] });
    expect(original.published).toBe(true);
    const manifestPath = path.join(f.outputDirectory, "manifest.json");
    const before = await readFile(manifestPath, "utf8");
    const checked = await materializeObjects({ ...f, definitions: [project], check: true });
    expect(checked.valid).toBe(true);
    expect(checked.clean).toBe(false);
    expect(checked.published).toBe(false);
    expect(checked.manifest?.schemaFingerprint).not.toBe(original.manifest?.schemaFingerprint);
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    expect((await materializeObjects({ ...f, definitions: [project] })).published).toBe(true);
    expect((await materializeObjects({ ...f, definitions: [project], check: true })).clean).toBe(
      true,
    );
  } finally {
    await f.close();
  }
});
