import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

test("fields tools advertise the typed wire contract and strict input fields", async () => {
  await withObjectFieldsClient(async ({ client }) => {
    const { tools } = await client.listTools();
    const get = tools.find((tool) => tool.name === "objects_fields_get");
    const update = tools.find((tool) => tool.name === "objects_fields_update");
    expect(get).toBeDefined();
    expect(get).toHaveProperty("name", "objects_fields_get");
    expect(get?.outputSchema).toHaveProperty("properties.checksum.type", "string");
    expect(update).toHaveProperty("inputSchema.required", [
      "type",
      "id",
      "expectedChecksum",
      "updatedAt",
    ]);
    expect(update).toHaveProperty(
      "inputSchema.properties.evidences.items.properties.source.properties.root.enum",
      ["project"],
    );
    expect(update).toHaveProperty("inputSchema.additionalProperties", false);
    expect(get).toHaveProperty(
      "outputSchema.properties.fields.properties.reviews.items.properties.workingTree.enum",
      ["clean", "dirty", "unknown"],
    );
    expect(get).toHaveProperty("outputSchema.properties.checksum.type", "string");
    expect(get).not.toHaveProperty("outputSchema.properties.metadata");
  });
});

test("fields read returns only present top-level fields and the current source checksum", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const stored = await framework.create(
      "adr",
      fieldsObject("adr", { decision, evidences: [evidence] }, legacy),
    );
    const result = await client.callTool({
      name: "objects_fields_get",
      arguments: { type: "adr", id: stored.object.id },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      type: "adr",
      id: stored.object.id,
      checksum: stored.checksum,
      fields: { decision, evidences: [evidence] },
    });
  });
});

test("fields read neither invents defaults nor copies legacy metadata", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const stored = await framework.create("adr", fieldsObject("adr", {}, legacy));
    const result = await client.callTool({
      name: "objects_fields_get",
      arguments: { type: "adr", id: stored.object.id },
    });
    expect(result.structuredContent).toHaveProperty("fields", {});
    expect((await framework.get("adr", stored.object.id)).object.metadata).toEqual(legacy);
  });
});

test("fields update preserves metadata, all unrelated header data and body with a caller timestamp", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const body = "# Preserve this body\n\nUnrelated details.\n";
    const stored = await framework.create("adr", fieldsObject("adr", { decision }, legacy), body);
    const updatedAt = "2026-11-01T09:10:11+02:00";
    const result = await client.callTool({
      name: "objects_fields_update",
      arguments: {
        type: "adr",
        id: stored.object.id,
        expectedChecksum: stored.checksum,
        updatedAt,
        fileBindings: [binding],
        evidences: [evidence],
        reviews: [review],
      },
    });
    expect(result.isError).not.toBe(true);
    const current = await framework.get("adr", stored.object.id);
    const expectedObject = {
      ...stored.object,
      updatedAt: new Date(updatedAt),
      fileBindings: [binding],
      evidences: [evidence],
      reviews: [review],
    };
    expect(current).toEqual({
      ...stored,
      checksum: current.checksum,
      object: expectedObject,
    });
    expect(JSON.stringify(current.object.metadata)).toBe(JSON.stringify(stored.object.metadata));
    expect(current.checksum).not.toBe(stored.checksum);
    expect(result.structuredContent).toHaveProperty("checksum", current.checksum);
    expect(result.structuredContent).toHaveProperty("object.metadata", legacy);
  });
});

test("explicit null and empty arrays clear fields while omitted fields and every metadata key remain", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const stored = await framework.create(
      "adr",
      fieldsObject(
        "adr",
        { decision, fileBindings: [binding], evidences: [evidence], reviews: [review] },
        legacy,
      ),
    );
    const result = await client.callTool({
      name: "objects_fields_update",
      arguments: {
        type: "adr",
        id: stored.object.id,
        expectedChecksum: stored.checksum,
        updatedAt: timestamp,
        decision: null,
        evidences: [],
        reviews: [],
      },
    });
    expect(result.isError).not.toBe(true);
    const current = await framework.get("adr", stored.object.id);
    expect(Object.hasOwn(current.object, "decision")).toBe(false);
    expect(current.object).toHaveProperty("fileBindings", [binding]);
    expect(current.object).toHaveProperty("evidences", []);
    expect(current.object).toHaveProperty("reviews", []);
    expect(current.object.metadata).toEqual(legacy);
  });
});

test("decision replacement and binding clearing retain omitted evidence", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const stored = await framework.create(
      "adr",
      fieldsObject("adr", { fileBindings: [binding], evidences: [evidence] }, legacy),
    );
    const result = await client.callTool({
      name: "objects_fields_update",
      arguments: {
        type: "adr",
        id: stored.object.id,
        expectedChecksum: stored.checksum,
        updatedAt: timestamp,
        decision: { status: "superseded" },
        fileBindings: [],
      },
    });
    expect(result.isError).not.toBe(true);
    const current = await framework.get("adr", stored.object.id);
    expect(current.object).toHaveProperty("decision", { status: "superseded" });
    expect(current.object).toHaveProperty("fileBindings", []);
    expect(current.object).toHaveProperty("evidences", [evidence]);
    expect(current.object.metadata).toEqual(legacy);
  });
});

test("stale fields updates leave source bytes unchanged", async () => {
  await withObjectFieldsClient(
    async ({ framework, client, directory }) => {
      const stored = await framework.create("adr", fieldsObject());
      const filename = path.join(directory, "objects", stored.path);
      const raw = await readFile(filename, "utf8");
      const result = await client.callTool({
        name: "objects_fields_update",
        arguments: {
          type: "adr",
          id: stored.object.id,
          expectedChecksum: "stale",
          updatedAt: timestamp,
          decision,
        },
      });
      expect(result.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
      expect(await readFile(filename, "utf8")).toBe(raw);
    },
    undefined,
    undefined,
    { checksumGuard: true },
  );
});

test("competing revisions between fields read and guarded write are not overwritten", async () => {
  await withObjectFieldsClient(
    async ({ framework, client }) => {
      const stored = await framework.create("adr", fieldsObject(), "Old body");
      const update = framework.update.bind(framework);
      framework.update = async (...args: Parameters<typeof framework.update>) => {
        await update(
          "adr",
          stored.object.id,
          { ...stored.object, title: "Concurrent revision" },
          "Latest body",
          stored.checksum,
        );
        return update(...args);
      };
      const result = await client.callTool({
        name: "objects_fields_update",
        arguments: {
          type: "adr",
          id: stored.object.id,
          expectedChecksum: stored.checksum,
          updatedAt: timestamp,
          reviews: [],
        },
      });
      expect(result.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
      const current = await framework.get("adr", stored.object.id);
      expect(current.body).toBe("Latest body");
      expect(current.object.title).toBe("Concurrent revision");
      expect(Object.hasOwn(current.object, "reviews")).toBe(false);
    },
    undefined,
    undefined,
    { checksumGuard: true },
  );
});

test("non-ADR fields read does not expose an opaque metadata decision", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const stored = await framework.create("project", fieldsObject("project", {}, legacy));
    const result = await client.callTool({
      name: "objects_fields_get",
      arguments: { type: "project", id: stored.object.id },
    });
    expect(result.structuredContent).toHaveProperty("fields", {});
  });
});

test("fields tools retain snake_case input repair and its notice", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const stored = await framework.create("adr", fieldsObject("adr", {}, legacy));
    const result = await client.callTool({
      name: "objects_fields_update",
      arguments: {
        type: "adr",
        id: stored.object.id,
        expected_checksum: stored.checksum,
        updated_at: timestamp,
        file_bindings: [],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result._meta).toHaveProperty("object-mcp/input-repair.repairs");
    const current = await framework.get("adr", stored.object.id);
    expect(current.object).toHaveProperty("fileBindings", []);
    expect(current.object.metadata).toEqual(legacy);
  });
});
