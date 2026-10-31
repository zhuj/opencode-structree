import { expect, test } from "bun:test";
import { coreDefinitions, createCoreRegistry } from "../src/registry.ts";
import {
  binding,
  decision,
  evidence,
  fieldsObject,
  legacy,
  review,
  withObjectFieldsClient,
} from "./helpers/object-fields-fixture.ts";

const relations: Record<string, Record<string, unknown>> = {
  project: { partOf: null },
  project_goal: { project: "p", partOf: null },
  feature: { project: "p", commitment: { goals: [] } },
  scenario: { project: "p", partOf: null, dependsOn: [], commitment: { features: [] } },
  scenario_acceptance_criteria: { scenario: "s", dependsOn: [] },
  adr: { partOf: null, dependsOn: [], commitment: { scenarios: [] } },
  contract: { partOf: null, dependsOn: [], commitsTo: [] },
  interface: { partOf: null, dependsOn: [], usedBy: [], commitsTo: [] },
  entity: { partOf: null, dependsOn: [], usedBy: [], usedIn: [], commitsTo: [] },
  unit_test: { partOf: null, dependsOn: [], relatesTo: [], commitsTo: [] },
  scenario_test: { partOf: null, dependsOn: [], relatesTo: [], commitsTo: [] },
  acceptance_test: { partOf: null, dependsOn: [], commitsTo: [] },
};
const opaque = {
  ...legacy,
  decision: { status: "custom-label" },
  fileBindings: "not an array",
  evidences: false,
  reviews: { arbitrary: true },
};

test.each(coreDefinitions.map((definition) => definition.name))(
  "%s CRUD preserves unrestricted metadata without acquiring top-level fields",
  async (type) => {
    await withObjectFieldsClient(async ({ framework }) => {
      const input = { ...fieldsObject(), metadata: opaque, relations: relations[type] };
      const created = await framework.create(type, input, "Body");
      const updated = await framework.update(
        type,
        created.object.id,
        { ...created.object, title: "Changed" },
        created.body,
        created.checksum,
      );
      expect(updated.object.metadata).toEqual(opaque);
      for (const key of ["decision", "fileBindings", "evidences", "reviews"]) {
        expect(Object.hasOwn(created.object, key)).toBe(false);
        expect(Object.hasOwn(updated.object, key)).toBe(false);
      }
    });
  },
);

test("ADR top-level fields round-trip separately from opaque metadata", () => {
  const registry = createCoreRegistry();
  const input = {
    ...fieldsObject(),
    metadata: opaque,
    decision,
    evidences: [evidence],
    reviews: [review],
    fileBindings: [],
  };
  expect(registry.encode("adr", input)).toEqual(input);
});

test.each(coreDefinitions.map((definition) => definition.name))(
  "%s validates common optional top-level fields independently of metadata",
  (type) => {
    const registry = createCoreRegistry();
    const input = {
      ...fieldsObject(),
      metadata: opaque,
      relations: relations[type],
      fileBindings: [binding],
      evidences: [evidence],
      reviews: [review],
    };
    expect(registry.encode(type, input)).toEqual(input);
    for (const fields of [
      { fileBindings: "opaque" },
      { evidences: [evidence, evidence] },
      { reviews: [{ ...review, reviewedAt: "invalid" }] },
    ])
      expect(() => registry.decode(type, { ...input, ...fields })).toThrow();
  },
);

test.each(
  coreDefinitions
    .filter((definition) => definition.name !== "adr")
    .map((definition) => definition.name),
)("%s rejects a top-level decision but not metadata.decision", (type) => {
  const registry = createCoreRegistry();
  const input = { ...fieldsObject(), metadata: opaque, relations: relations[type] };
  expect(registry.decode(type, input).metadata).toEqual(opaque);
  expect(() => registry.decode(type, { ...input, decision })).toThrow();
});

test("the application advertises fields tools instead of aliases for metadata tools", async () => {
  await withObjectFieldsClient(async ({ client }) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("objects_fields_get");
    expect(names).toContain("objects_fields_update");
    expect(names).not.toContain("objects_metadata_get");
    expect(names).not.toContain("objects_metadata_update");
  });
});
