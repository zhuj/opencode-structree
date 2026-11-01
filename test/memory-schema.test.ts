import { expect, test } from "bun:test";
import { Schema } from "effect";
import { createMemoryRegistry, memoryDefinition } from "../src/memory/registry.ts";
import { MemorySchema, memoryCategorySchemas } from "../src/memory/schemas/index.ts";
import * as publicSchemas from "../src/schemas/index.ts";
import { memoryObject, memoryRelations } from "./helpers/memory-fixture.ts";
import { binding, evidence, review } from "./helpers/object-fields-fixture.ts";

test("all twelve memory categories share the base and retain category literals", () => {
  const registry = createMemoryRegistry();
  expect(Object.keys(memoryCategorySchemas)).toEqual([
    "lessons",
    "approaches",
    "rules",
    "architecture",
    "decisions",
    "interfaces",
    "domain",
    "environment",
    "operations",
    "testing",
    "security",
    "investigations",
  ]);
  expect(memoryDefinition).toMatchObject({
    name: "memory",
    directory: "memories",
    fieldsProfile: "common",
  });
  expect(publicSchemas.MemorySchema).toBe(MemorySchema);
  for (const [category, schema] of Object.entries(memoryCategorySchemas)) {
    const object = memoryObject({
      category,
      fileBindings: [binding],
      evidences: [evidence],
      reviews: [review],
    });
    const decoded = registry.decode("memory", object);
    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect(registry.encode("memory", decoded)).toEqual(object);
    expect(Schema.is(schema)({ ...decoded, category })).toBe(true);
    expect(Schema.is(schema)({ ...decoded, category: "not-a-category" })).toBe(false);
    expect(() =>
      registry.decode("memory", { ...object, decision: { status: "accepted" } }),
    ).toThrow();
    expect(decoded).not.toHaveProperty("decision");
    expect(decoded.metadata).toEqual(object.metadata);
  }
});

test("memory requires shared metadata, enum values and all relation arrays", () => {
  const registry = createMemoryRegistry();
  const object = memoryObject();
  for (const field of Object.keys(object)) {
    const incomplete: Record<string, unknown> = { ...object };
    delete incomplete[field];
    expect(() => registry.decode("memory", incomplete)).toThrow();
  }
  for (const [field, value] of Object.entries({
    category: "tasks",
    status: "accepted",
    confidence: "certain",
    labels: {},
    scope: "**",
    tags: [],
  }))
    expect(() => registry.decode("memory", { ...object, [field]: value })).toThrow();
  for (const key of Object.keys(memoryRelations())) {
    const relations: Record<string, unknown> = memoryRelations();
    delete relations[key];
    expect(() => registry.decode("memory", { ...object, relations })).toThrow();
    expect(() =>
      registry.decode("memory", { ...object, relations: { ...memoryRelations(), [key]: ["a/b"] } }),
    ).toThrow();
  }
  expect(
    registry.decode("memory", {
      ...object,
      relations: { ...memoryRelations(), buildsOn: ["OTHER"] },
    }),
  ).toHaveProperty("relations.buildsOn", ["OTHER"]);
});

test("reviewAfter is an optional real date or explicit empty string, never a timestamp or null", () => {
  const registry = createMemoryRegistry();
  for (const reviewAfter of ["", "2024-02-29", "2026-12-31", "2000-02-29"]) {
    expect(registry.decode("memory", memoryObject({ reviewAfter }))).toHaveProperty(
      "reviewAfter",
      reviewAfter,
    );
  }
  for (const reviewAfter of [
    null,
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "1900-02-29",
    "2026-13-01",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
  ]) {
    expect(() => registry.decode("memory", memoryObject({ reviewAfter }))).toThrow();
  }
  expect(registry.decode("memory", memoryObject())).not.toHaveProperty("reviewAfter");
});

test("all memory relations retain their declared direction and conservative impact kind", () => {
  expect(memoryDefinition.relations).toEqual([
    { path: "buildsOn", kind: "depends", targetType: "memory", cardinality: "many" },
    ...["supersedes", "contradicts", "relatedTo"].map((path) => ({
      path,
      kind: "relates" as const,
      targetType: "memory",
      cardinality: "many" as const,
    })),
    { path: "implements", kind: "justifies", targetType: "memory", cardinality: "many" },
    { path: "constrains", kind: "relates", targetType: "memory", cardinality: "many" },
    ...["motivatedBy", "validatedBy"].map((path) => ({
      path,
      kind: "justifies" as const,
      targetType: "memory",
      cardinality: "many" as const,
    })),
  ]);
});
