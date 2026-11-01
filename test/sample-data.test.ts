import { expect, test } from "bun:test";
import { sampleData } from "../examples/sample-data.ts";
import { coreDefinitions, createCoreRegistry } from "../src/registry.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test("default seed examples cover every registered type exactly once and satisfy its full schema", () => {
  const sampleTypes: readonly string[] = sampleData.map((sample) => sample.type);
  expect(sampleTypes).toEqual(coreDefinitions.map((definition) => definition.name));
  const registry = createCoreRegistry();
  for (const sample of sampleData) {
    const encoded = registry.encode(sample.type, sample.object);
    expect(registry.decode(sample.type, encoded)).toEqual(sample.object);
    expect(sample.body.trim().length).toBeGreaterThan(0);
  }
});

test("seed examples persist through ordinary create and duplicate runs preserve existing source", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const revisions = new Map<string, string>();
    for (const sample of sampleData) {
      const created = await framework.create(sample.type, sample.object, sample.body);
      revisions.set(sample.type, created.checksum);
    }
    for (const sample of sampleData) {
      await expect(framework.create(sample.type, sample.object, sample.body)).rejects.toMatchObject(
        { code: "ALREADY_EXISTS" },
      );
      const stored = await framework.get(sample.type, sample.object.id);
      expect(revisions.get(sample.type)).toBe(stored.checksum);
      expect(stored.object).toEqual(sample.object);
      expect(stored.body).toBe(sample.body);
    }
    const memory = await framework.get("memory", "example-memory");
    expect(memory.path).toBe("memories/example-memory.md");
    expect(memory.object).toHaveProperty("category", "architecture");
    expect(memory.object).toHaveProperty("status", "draft");
  });
});
