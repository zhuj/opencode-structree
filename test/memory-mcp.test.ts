import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { memoryDefinitions } from "../src/memory/registry.ts";
import { memoryObject, memoryRelations } from "./helpers/memory-fixture.ts";
import { timestamp, withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test("default application registers generic memory CRUD and four specialized tools", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    expect(framework.definitions.map((d) => d.name)).toHaveLength(13);
    const names = (await client.listTools()).tools.map((t) => t.name);
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "memory_context")).toHaveProperty(
      "outputSchema.properties.memories.items.properties.currentGuidance.type",
      "boolean",
    );
    expect(tools.find((t) => t.name === "memory_set_status")).toHaveProperty(
      "outputSchema.properties.checksum.type",
      "string",
    );
    expect(tools.find((t) => t.name === "memory_related")).toHaveProperty(
      "outputSchema.properties.edges.items.properties.field.type",
      "string",
    );
    for (const name of [
      "memory_create",
      "memory_get",
      "memory_update",
      "memory_delete",
      "memory_list",
      "memory_context",
      "memory_search",
      "memory_related",
      "memory_set_status",
    ])
      expect(names).toContain(name);
    expect(names).toHaveLength(76);
    const result = await client.callTool({
      name: "memory_create",
      arguments: {
        object: memoryObject({
          id: "UPPER",
          relations: { ...memoryRelations(), buildsOn: ["OTHER"] },
        }),
        body: "# Lesson\n\nEvidence stays in the body.",
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty("object.id", "upper");
    expect(result.structuredContent).toHaveProperty("object.relations.buildsOn", ["other"]);
  });
});

test("context filters a source page without claiming matching totals, expiration or investigation certainty", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    await framework.create("memory", memoryObject({ id: "a", status: "draft" }));
    await framework.create(
      "memory",
      memoryObject({ id: "b", category: "investigations", reviewAfter: "2020-01-01" }),
    );
    await framework.create("memory", memoryObject({ id: "c", retiredAt: timestamp }));
    const first = await client.callTool({ name: "memory_context", arguments: { limit: 1 } });
    expect(first.structuredContent).toMatchObject({
      memories: [],
      source: { offset: 0, limit: 1, total: 3, continuation: { offset: 1 } },
      matchingTotal: null,
      exhaustive: false,
      asOf: null,
    });
    const second = await client.callTool({
      name: "memory_context",
      arguments: { offset: 1, asOf: "2026-10-31" },
    });
    expect(second.structuredContent).toHaveProperty(
      "memories.0",
      expect.objectContaining({
        id: "b",
        currentGuidance: true,
        uncertainty: true,
        reviewDue: true,
        status: "active",
      }),
    );
    expect(second.structuredContent).toHaveProperty("memories.length", 1);
    const all = await client.callTool({
      name: "memory_context",
      arguments: {
        status: "active",
        includeRetired: true,
        category: "lessons",
        label: "retrieval",
      },
    });
    expect(all.structuredContent).toHaveProperty(
      "memories.0",
      expect.objectContaining({ id: "c", currentGuidance: false, reviewDue: null }),
    );
    expect((await framework.get("memory", "b")).object).toHaveProperty("status", "active");
  }, memoryDefinitions);
});

test("readable partial memory stays diagnostic and unmodified, never guidance or status-update input", async () => {
  await withObjectFieldsClient(async ({ client, framework, directory }) => {
    const stored = await framework.create("memory", memoryObject());
    const filename = path.join(directory, "objects", stored.path);
    const raw =
      "---\nid: memory-1\nstatus: active\ncategory: rules\n---\n# Incomplete authored content\n";
    await writeFile(filename, raw);
    const context = await client.callTool({ name: "memory_context", arguments: {} });
    expect(context.isError).not.toBe(true);
    expect(context.structuredContent).toHaveProperty("memories", []);
    expect(context.structuredContent).toHaveProperty("diagnostics.0.partial", true);
    const update = await client.callTool({
      name: "memory_set_status",
      arguments: {
        id: stored.object.id,
        from: "active",
        to: "obsolete",
        reason: "Explicit invalidation",
        updatedAt: timestamp,
        expectedChecksum: stored.checksum,
      },
    });
    expect(update.structuredContent).toHaveProperty("error.code", "VALIDATION_ERROR");
    expect(await readFile(filename, "utf8")).toBe(raw);
  }, memoryDefinitions);
});

test("outgoing memory relationships preserve labels, findings and lack of automatic backlinks or status changes", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const target = await framework.create(
      "memory",
      memoryObject({ id: "target", category: "rules" }),
    );
    await framework.create(
      "memory",
      memoryObject({
        relations: Object.fromEntries(
          Object.keys(memoryRelations()).map((k) => [k, ["target", "missing"]]),
        ),
      }),
    );
    const related = await client.callTool({
      name: "memory_related",
      arguments: { id: "memory-1" },
    });
    expect(related.isError).not.toBe(true);
    const graph = related.structuredContent as {
      edges: { field: string; direction: string }[];
      findings: { code: string }[];
    };
    expect(new Set(graph.edges.map((e) => e.field))).toEqual(
      new Set(Object.keys(memoryRelations()).map((k) => `relations.${k}`)),
    );
    expect(graph.edges.every((e) => e.direction === "outgoing")).toBe(true);
    expect(graph.findings.some((f) => f.code === "DANGLING_TARGET")).toBe(true);
    const reverse = await client.callTool({ name: "memory_related", arguments: { id: "target" } });
    expect(reverse.structuredContent).toHaveProperty("edges", []);
    expect((await framework.get("memory", "target")).object).toEqual(target.object);
    const deep = await client.callTool({
      name: "memory_related",
      arguments: { id: "target", depth: 3 },
    });
    expect(deep.isError).toBe(true);
  }, memoryDefinitions);
});
