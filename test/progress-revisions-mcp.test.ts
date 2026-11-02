import { expect, test } from "bun:test";
import { Schema } from "effect";
import { planProgress } from "../src/progress/mutations.ts";
import { ProgressSummarySchema } from "../src/progress/tool-schemas.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test("progress_update advertises additive optional revision fields with existing input bounds", async () => {
  await withObjectFieldsClient(async ({ client }) => {
    const tools = (await client.listTools()).tools;
    const update = tools.find((tool) => tool.name === "progress_update");
    expect(update).toHaveProperty("inputSchema.required", ["id", "expectedChecksum"]);
    expect(update).toHaveProperty("inputSchema.properties.title.maxLength", 200);
    expect(update).toHaveProperty("inputSchema.properties.outcome.maxLength", 4000);
    expect(update).toHaveProperty("inputSchema.properties.acceptance.maxItems", 50);
    expect(update).toHaveProperty("inputSchema.properties.body.type", "string");
    expect(update?.description).toContain("checkpoint.note");
  });
});

test("MCP revisions round-trip all four fields while the compact response leaves body to work_item_get", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const planned = await planProgress(framework, { title: "Before", outcome: "Before outcome" });
    const before = await framework.get("work_item", planned.id);
    const revised = await client.callTool({
      name: "progress_update",
      arguments: {
        id: planned.id,
        expectedChecksum: planned.checksum,
        title: "After",
        outcome: "After outcome",
        acceptance: ["Explicit new condition"],
        body: "# Owner-authored detail\n",
        checkpoint: { note: "The owner clarified the plan" },
      },
    });
    expect(revised.isError).not.toBe(true);
    const summary = Schema.decodeUnknownSync(ProgressSummarySchema)(revised.structuredContent);
    expect(summary).toMatchObject({
      id: planned.id,
      title: "After",
      outcome: "After outcome",
      acceptance: ["Explicit new condition"],
      checkpointCount: 1,
      status: "planned",
      verification: { state: "pending" },
      acceptanceEstablished: false,
    });
    expect(revised.structuredContent).not.toHaveProperty("body");
    const full = await client.callTool({ name: "work_item_get", arguments: { id: planned.id } });
    expect(full.isError).not.toBe(true);
    expect(full.structuredContent).toHaveProperty("body", "# Owner-authored detail\n");
    expect(full.structuredContent).toHaveProperty("object.name", before.object.name);
    expect(full.structuredContent).toHaveProperty("object.description", before.object.description);
    const cleared = await client.callTool({
      name: "progress_update",
      arguments: {
        id: planned.id,
        expectedChecksum: summary.checksum,
        acceptance: [],
        body: "",
        checkpoint: { note: "Explicitly remove superseded detail and criteria" },
      },
    });
    expect(cleared.isError).not.toBe(true);
    expect(cleared.structuredContent).toMatchObject({
      title: "After",
      outcome: "After outcome",
      acceptance: [],
      checkpointCount: 2,
    });
    expect((await framework.get("work_item", planned.id)).body).toBe("");
  });
});

test.each([
  { field: "blank title", changes: { title: "   " } },
  { field: "blank outcome", changes: { outcome: "\n\t" } },
  { field: "oversized title", changes: { title: "x".repeat(201) } },
  { field: "oversized outcome", changes: { outcome: "x".repeat(4001) } },
])("MCP rejects $field without mutation", async ({ changes }) => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const planned = await planProgress(framework, { title: "Valid", outcome: "Valid outcome" });
    const before = await framework.get("work_item", planned.id);
    const result = await client.callTool({
      name: "progress_update",
      arguments: {
        id: planned.id,
        expectedChecksum: planned.checksum,
        ...changes,
        checkpoint: { note: "A reason does not make invalid plan text valid" },
      },
    });
    expect(result.isError).toBe(true);
    expect(await framework.get("work_item", planned.id)).toEqual(before);
  });
});

test("MCP rejects a body clear without its explicit revision note even when status supplies a generated note", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const planned = await planProgress(framework, {
      title: "Preserve",
      outcome: "Require an authored reason",
    });
    const before = await framework.get("work_item", planned.id);
    const result = await client.callTool({
      name: "progress_update",
      arguments: {
        id: planned.id,
        expectedChecksum: planned.checksum,
        body: "",
        status: "active",
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toHaveProperty("error.code", "VALIDATION_ERROR");
    expect(result.structuredContent).toHaveProperty(
      "error.message",
      expect.stringContaining("checkpoint.note"),
    );
    expect(await framework.get("work_item", planned.id)).toEqual(before);
  });
});
