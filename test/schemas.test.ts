import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { coreDefinitions, createCoreRegistry, ObjectRegistry } from "../src/registry";
import { BaseObjectSchema, FeatureSchema, ScenarioSchema } from "../src/schemas";

const relationships: Record<string, Record<string, unknown>> = {
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

function object(type: string): Record<string, unknown> {
  return {
    id: `${type}-arbitrary-identifier`,
    name: "",
    title: "Title",
    description: "Description",
    createdAt: new Date("2026-10-15T00:00:00Z"),
    updatedAt: new Date("2026-10-18T00:00:00Z"),
    retiredAt: null,
    tags: { language: "en" },
    metadata: { nested: [null, true, 3, "text"] },
    relations: structuredClone(relationships[type]),
  };
}

describe("the twelve core Effect schemas", () => {
  test("contain the exact concrete entities and each required relationship", () => {
    expect(coreDefinitions.map(({ name }) => name)).toEqual(Object.keys(relationships));
    for (const definition of coreDefinitions) {
      const decoded = Schema.decodeUnknownSync(definition.schema)(object(definition.name));
      expect((decoded as unknown as { relations: unknown }).relations).toEqual(
        relationships[definition.name],
      );
      for (const key of Object.keys(object(definition.name))) {
        const incomplete = object(definition.name);
        delete incomplete[key];
        expect(() => Schema.decodeUnknownSync(definition.schema)(incomplete)).toThrow();
      }
      for (const key of Object.keys(relationships[definition.name]!)) {
        const incomplete = object(definition.name);
        delete (incomplete.relations as Record<string, unknown>)[key];
        expect(() => Schema.decodeUnknownSync(definition.schema)(incomplete)).toThrow();
      }
      const commitment = relationships[definition.name]!.commitment;
      if (commitment) {
        const incomplete = object(definition.name);
        (incomplete.relations as Record<string, unknown>).commitment = {};
        expect(() => Schema.decodeUnknownSync(definition.schema)(incomplete)).toThrow();
      }
    }
  });

  test("reject invalid identifiers without validating relation targets or relationship integrity", () => {
    const feature = {
      ...object("feature"),
      relations: { project: "unregistered project", commitment: { goals: ["same", "same"] } },
    };
    expect(() => Schema.decodeUnknownSync(FeatureSchema)({ ...feature, id: "" })).toThrow();
    expect(() => Schema.decodeUnknownSync(FeatureSchema)({ ...feature, id: "a/b" })).toThrow();
    expect(() => Schema.decodeUnknownSync(FeatureSchema)({ ...feature, id: "Con" })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(FeatureSchema)({
        ...feature,
        relations: { ...feature.relations, project: "" },
      }),
    ).toThrow();
    expect(Schema.decodeUnknownSync(FeatureSchema)(feature).relations.project).toBe(
      "unregistered project",
    );
    expect(Schema.decodeUnknownSync(FeatureSchema)(feature).relations.commitment.goals).toEqual([
      "same",
      "same",
    ]);
    const scenario = {
      ...object("scenario"),
      id: "self",
      relations: {
        project: "missing",
        partOf: "self",
        dependsOn: ["self"],
        commitment: { features: [] },
      },
    };
    expect(Schema.decodeUnknownSync(ScenarioSchema)(scenario).relations.partOf).toBe("self");
    expect(() =>
      Schema.decodeUnknownSync(ScenarioSchema)({
        ...scenario,
        relations: { ...scenario.relations, dependsOn: [""] },
      }),
    ).toThrow();
    expect(Object.keys(FeatureSchema.fields.relations.fields)).toEqual(["project", "commitment"]);
  });

  test("nullable fields accept explicit null, and timestamps are domain Dates", () => {
    const registry = createCoreRegistry();
    for (const definition of coreDefinitions) {
      const decoded = registry.decode(definition.name, object(definition.name));
      expect(decoded.createdAt).toBeInstanceOf(Date);
      expect(decoded.retiredAt).toBeNull();
    }
    expect(
      Schema.decodeUnknownSync(ScenarioSchema)(object("scenario")).relations.partOf,
    ).toBeNull();
    expect(
      registry.decode("project", { ...object("project"), retiredAt: new Date("2026-10-18Z") })
        .retiredAt,
    ).toBeInstanceOf(Date);
  });
});

describe("registry wire and persistence boundaries", () => {
  test("round-trips every entity through canonical JSON without losing Date types", () => {
    const registry = createCoreRegistry();
    for (const definition of coreDefinitions) {
      const encoded = registry.encode(definition.name, object(definition.name));
      expect(encoded.createdAt).toBe("2026-10-15T00:00:00.000Z");
      const decoded = registry.decode(definition.name, JSON.parse(JSON.stringify(encoded)));
      expect(decoded.createdAt).toBeInstanceOf(Date);
      expect(decoded as unknown).toEqual(object(definition.name));
      expect(() =>
        registry.decode(definition.name, { ...encoded, belongsTo: "unexpected" }),
      ).toThrow();
    }
  });

  test("rejects metadata that JSON serialization would silently alter or omit", () => {
    const registry = createCoreRegistry();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [undefined, Infinity, NaN, 1n, () => 1, new Date(), new Map(), cycle]) {
      const input = { ...object("project"), metadata: { value } };
      expect(() => Schema.decodeUnknownSync(BaseObjectSchema)(input)).not.toThrow();
      expect(() => registry.encode("project", input)).toThrow();
    }
  });

  test("generates required fields, strict object shapes, and truthful relationship descriptions", () => {
    const registry = createCoreRegistry();
    const schema = registry.jsonSchema("feature");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("retiredAt");
    for (const definition of coreDefinitions) {
      expect(registry.jsonSchema(definition.name)).toHaveProperty("properties.id.minLength", 1);
    }
    expect(schema).toHaveProperty(
      "properties.id.description",
      "The id is lowercased and must be a nonblank portable file name: no path separator, leading dot, control character or unpaired surrogate, not a reserved device name, and at most 200 UTF-8 bytes.",
    );
    for (const [type, relation] of [
      ["project_goal", "project"],
      ["feature", "project"],
      ["scenario", "project"],
      ["scenario_acceptance_criteria", "scenario"],
    ] as const) {
      expect(registry.jsonSchema(type)).toHaveProperty(
        `properties.relations.properties.${relation}.minLength`,
        1,
      );
    }
    expect(registry.jsonSchema("scenario")).toHaveProperty(
      "properties.relations.properties.dependsOn.items.minLength",
      1,
    );
    expect(schema).toHaveProperty(
      "properties.retiredAt.description",
      "Retirement timestamp, or null for an active object. A retired object is still listed and searchable; check this field to exclude it.",
    );
    expect(schema).toHaveProperty("properties.createdAt.type", "string");
    expect(schema).toHaveProperty("properties.relations.required", ["project", "commitment"]);
    expect(schema).toHaveProperty(
      "properties.relations.properties.project.description",
      "Required owning project identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    );
    expect(schema).toHaveProperty("properties.relations.properties.commitment.required", ["goals"]);
    expect(schema).toHaveProperty(
      "properties.relations.properties.commitment.properties.goals.type",
      "array",
    );
    expect(schema).not.toHaveProperty("properties.relations.properties.partOf");
  });

  test("registers custom Effect definitions and refuses ambiguous names or directories", () => {
    const schema = Schema.Struct({ ...BaseObjectSchema.fields, priority: Schema.NumberFromString });
    const registry = new ObjectRegistry().register({
      name: "note",
      directory: "custom/notes",
      description: "Custom notes",
      schema,
    });
    const { relations, ...base } = object("project");
    const encoded = registry.encode("note", { ...base, priority: 2 });
    expect(encoded.priority).toBe("2");
    expect((registry.decode("note", encoded) as unknown as { priority: number }).priority).toBe(2);
    expect(() =>
      registry.register({ name: "note", directory: "other", description: "Duplicate", schema }),
    ).toThrow();
    expect(() =>
      registry.register({
        name: "another",
        directory: "custom/notes/child",
        description: "Overlap",
        schema,
      }),
    ).toThrow();
    expect(() =>
      registry.register({ name: "../escape", directory: "other", description: "Invalid", schema }),
    ).toThrow();
    expect(() =>
      registry.register({
        name: "escape",
        directory: "../outside",
        description: "Invalid",
        schema,
      }),
    ).toThrow();
    expect(() => registry.get("unknown")).toThrow();
  });
});
