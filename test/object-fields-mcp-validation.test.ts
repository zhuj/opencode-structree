import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import { coreDefinitions } from "../src/registry.ts";
import {
  binding,
  decision,
  evidence,
  fieldsObject,
  legacy,
  review,
  timestamp,
  withObjectFieldsClient,
} from "./helpers/object-fields-fixture.ts";

test("partial source objects refuse fields reads and writes without repairing source", async () => {
  await withObjectFieldsClient(async ({ framework, client, directory }) => {
    const stored = await framework.create("adr", fieldsObject());
    const filename = path.join(directory, "objects", stored.path);
    const raw = "---\nid: fields-example\n---\n# Incomplete source\n";
    await writeFile(filename, raw);
    for (const name of ["objects_fields_get", "objects_fields_update"]) {
      const result = await client.callTool({
        name,
        arguments: {
          type: "adr",
          id: stored.object.id,
          ...(name.endsWith("update")
            ? { expectedChecksum: stored.checksum, updatedAt: timestamp, reviews: [] }
            : {}),
        },
      });
      expect(result.structuredContent).toHaveProperty("error.code", "VALIDATION_ERROR");
    }
    expect(await readFile(filename, "utf8")).toBe(raw);
  });
});

test("generic hosts advertise no fields tools for an unrelated adr definition", async () => {
  await withObjectFieldsClient(
    async ({ client }) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).not.toContain("objects_fields_get");
      expect(names).not.toContain("objects_fields_update");
    },
    [{ name: "adr", directory: "custom", description: "Custom", schema: BaseObjectSchema }],
  );
});

test("mixed hosts advertise only applicable types and omit decision input without ADR definitions", async () => {
  await withObjectFieldsClient(
    async ({ client }) => {
      const tools = (await client.listTools()).tools;
      const update = tools.find((tool) => tool.name === "objects_fields_update");
      expect(update).toHaveProperty("inputSchema.properties.type.anyOf.0.enum", ["project"]);
      expect(update).not.toHaveProperty("inputSchema.properties.decision");
      expect(
        (
          await client.callTool({
            name: "objects_fields_get",
            arguments: { type: "custom", id: "x" },
          })
        ).isError,
      ).toBe(true);
    },
    [
      ...coreDefinitions.filter((definition) => definition.name === "project"),
      { name: "custom", directory: "custom", description: "Custom", schema: BaseObjectSchema },
    ],
  );
});

test("focused fields reject invalid changes, no-ops, metadata input and invalid caller timestamps without writes", async () => {
  await withObjectFieldsClient(async ({ framework, client, directory }) => {
    const stored = await framework.create("adr", fieldsObject("adr", {}, legacy));
    const filename = path.join(directory, "objects", stored.path);
    const raw = await readFile(filename, "utf8");
    for (const change of [
      {},
      { metadata: {} },
      { decision: { status: "implemented" } },
      { reviews: [review, review] },
      { evidences: [evidence, evidence] },
      { fileBindings: [{ ...binding, unexpected: true }] },
      { decision, updatedAt: "yesterday" },
      { decision, updatedAt: "2026-02-30T00:00:00Z" },
      { decision, updatedAt: undefined },
      { evidences: [{ ...evidence, source: { root: "project", path: "../escape" } }] },
      { reviews: [{ ...review, workingTree: "staged" }] },
    ]) {
      const result = await client.callTool({
        name: "objects_fields_update",
        arguments: {
          type: "adr",
          id: stored.object.id,
          expectedChecksum: stored.checksum,
          updatedAt: timestamp,
          ...change,
        },
      });
      expect(result.isError).toBe(true);
      expect(await readFile(filename, "utf8")).toBe(raw);
    }
  });
});

test("decision updates are ADR-only while common updates preserve non-ADR metadata.decision", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const stored = await framework.create("project", fieldsObject("project", {}, legacy));
    for (const value of [decision, null]) {
      const result = await client.callTool({
        name: "objects_fields_update",
        arguments: {
          type: "project",
          id: stored.object.id,
          expectedChecksum: stored.checksum,
          updatedAt: timestamp,
          decision: value,
        },
      });
      expect(result.structuredContent).toHaveProperty("error.code", "VALIDATION_ERROR");
    }
    const result = await client.callTool({
      name: "objects_fields_update",
      arguments: {
        type: "project",
        id: stored.object.id,
        expectedChecksum: stored.checksum,
        updatedAt: timestamp,
        reviews: [],
      },
    });
    expect(result.isError).not.toBe(true);
    const current = await framework.get("project", stored.object.id);
    expect(current.object).toHaveProperty("reviews", []);
    expect(current.object.metadata).toEqual(legacy);
    expect(Object.hasOwn(current.object, "decision")).toBe(false);
  });
});

test("ordinary create and update refuse invalid top-level fields before writing", async () => {
  await withObjectFieldsClient(async ({ framework, directory }) => {
    await expect(
      framework.create("adr", fieldsObject("adr", { decision: { status: "invalid" } })),
    ).rejects.toHaveProperty("code", "VALIDATION_ERROR");
    const stored = await framework.create("adr", fieldsObject("adr", {}, legacy));
    const filename = path.join(directory, "objects", stored.path);
    const raw = await readFile(filename, "utf8");
    await expect(
      framework.update(
        "adr",
        stored.object.id,
        {
          ...stored.object,
          evidences: [evidence, evidence],
        },
        "Not published",
        stored.checksum,
      ),
    ).rejects.toHaveProperty("code", "VALIDATION_ERROR");
    expect(await readFile(filename, "utf8")).toBe(raw);
  });
});
