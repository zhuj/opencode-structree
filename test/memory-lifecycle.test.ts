import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { memoryDefinitions } from "../src/memory/registry.ts";
import { memoryObject, memoryRelations } from "./helpers/memory-fixture.ts";
import {
  binding,
  evidence,
  review,
  timestamp,
  withObjectFieldsClient,
} from "./helpers/object-fields-fixture.ts";

test("status update preserves every unrelated field and body, appending only a caller-dated lifecycle note", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const body = "# Decision\n\nOutcome: rejected. Preserve original rationale.\n";
    const stored = await framework.create(
      "memory",
      memoryObject({
        category: "decisions",
        fileBindings: [binding],
        evidences: [evidence],
        reviews: [review],
        relations: { ...memoryRelations(), supersedes: ["missing"] },
      }),
      body,
    );
    const result = await client.callTool({
      name: "memory_set_status",
      arguments: {
        id: stored.object.id,
        from: "active",
        to: "superseded",
        reason: "Replaced after explicit review",
        updatedAt: "2026-11-01T09:10:11+02:00",
        expectedChecksum: stored.checksum,
      },
    });
    expect(result.isError).not.toBe(true);
    const current = await framework.get("memory", stored.object.id);
    expect(current.object).toEqual({
      ...stored.object,
      status: "superseded",
      updatedAt: new Date("2026-11-01T07:10:11Z"),
    });
    expect(current.body.startsWith(body)).toBe(true);
    expect(current.body).toContain(
      "2026-11-01T07:10:11.000Z: active -> superseded. Replaced after explicit review",
    );
    expect(current.object).not.toHaveProperty("decision");
    const fields = await client.callTool({
      name: "objects_fields_get",
      arguments: { type: "memory", id: stored.object.id },
    });
    expect(fields.structuredContent).toHaveProperty("fields", {
      fileBindings: [binding],
      evidences: [evidence],
      reviews: [review],
    });
  }, memoryDefinitions);
});

test("status mismatch, stale checksum and blank reason cannot change source bytes", async () => {
  await withObjectFieldsClient(async ({ client, framework, directory }) => {
    const stored = await framework.create("memory", memoryObject(), "Original body");
    const filename = path.join(directory, "objects", stored.path);
    const raw = await readFile(filename, "utf8");
    const args = {
      id: stored.object.id,
      from: "active",
      to: "obsolete",
      reason: "Not applicable",
      updatedAt: timestamp,
      expectedChecksum: stored.checksum,
    };
    for (const [change, code] of [
      [{ from: "draft" }, "CONFLICT"],
      [{ expectedChecksum: "stale" }, "CHECKSUM_CONFLICT"],
    ] as const) {
      const result = await client.callTool({
        name: "memory_set_status",
        arguments: { ...args, ...change },
      });
      expect(result.structuredContent).toHaveProperty("error.code", code);
      expect(await readFile(filename, "utf8")).toBe(raw);
    }
    const blank = await client.callTool({
      name: "memory_set_status",
      arguments: { ...args, reason: " \n " },
    });
    expect(blank.isError).toBe(true);
    expect(await readFile(filename, "utf8")).toBe(raw);
  }, memoryDefinitions);
});

test("concurrent status writes preserve the winning source revision", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const stored = await framework.create("memory", memoryObject(), "Original");
    const update = framework.update.bind(framework);
    framework.update = async (...args) => {
      await update(
        "memory",
        stored.object.id,
        { ...stored.object, title: "Concurrent revision" },
        "Winning body",
        stored.checksum,
      );
      return update(...args);
    };
    const result = await client.callTool({
      name: "memory_set_status",
      arguments: {
        id: stored.object.id,
        from: "active",
        to: "obsolete",
        reason: "Explicit change",
        updatedAt: timestamp,
        expectedChecksum: stored.checksum,
      },
    });
    expect(result.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
    expect((await framework.get("memory", stored.object.id)).body).toBe("Winning body");
  }, memoryDefinitions);
});

test("all explicit lifecycle pairs are allowed without changing confidence, retirement or targets", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const statuses = ["draft", "active", "superseded", "obsolete"] as const;
    for (const from of statuses)
      for (const to of statuses) {
        const stored = await framework.create(
          "memory",
          memoryObject({ id: `${from}-${to}`, status: from, retiredAt: timestamp }),
        );
        const result = await client.callTool({
          name: "memory_set_status",
          arguments: {
            id: stored.object.id,
            from,
            to,
            reason: "Explicit lifecycle correction",
            updatedAt: timestamp,
            expectedChecksum: stored.checksum,
          },
        });
        expect(result.isError).not.toBe(true);
        expect((await framework.get("memory", stored.object.id)).object).toEqual({
          ...stored.object,
          status: to,
        });
      }
  }, memoryDefinitions);
});
