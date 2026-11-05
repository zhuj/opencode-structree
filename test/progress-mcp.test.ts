import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { BaseObjectSchema } from "../src/base-schema.ts";
import type { ObjectFacade } from "../src/lib/types.ts";
import { registerProgressTools } from "../src/progress/mcp.ts";
import { progressDefinitions, workItemDefinition } from "../src/progress/registry.ts";
import { ProgressSummarySchema } from "../src/progress/tool-schemas.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

function progressServer(facade: ObjectFacade): McpServer {
  const server = new McpServer({ name: "progress-test", version: "1" });
  registerProgressTools(server, facade);
  return server;
}

test("planning accepts a unique descriptive slug and rejects unsafe names", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      const args = { name: "Ship-Feature", title: "Ship", outcome: "Done" };
      const created = await client.callTool({ name: "progress_plan", arguments: args });
      expect(created.isError).not.toBe(true);
      expect(created.structuredContent).toHaveProperty("id", "ship-feature");
      expect((await framework.get("work_item", "ship-feature")).path).toEndWith("/ship-feature.md");
      const duplicate = await client.callTool({ name: "progress_plan", arguments: args });
      expect(duplicate.structuredContent).toHaveProperty("error.code", "ALREADY_EXISTS");
      for (const name of ["../escape", "nul", "two words", ""]) {
        expect(
          (await client.callTool({ name: "progress_plan", arguments: { ...args, name } })).isError,
        ).toBe(true);
      }
    },
    progressDefinitions,
    progressServer,
  );
});

test("four compact intent tools expose server-owned planning and a guarded update", async () => {
  await withObjectFieldsClient(
    async ({ client }) => {
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "progress_plan",
        "progress_resume",
        "progress_review",
        "progress_update",
      ]);
      expect(tools.find((tool) => tool.name === "progress_plan")).toHaveProperty(
        "inputSchema.required",
        ["title", "outcome"],
      );
      expect(tools.find((tool) => tool.name === "progress_resume")).toHaveProperty(
        "annotations.readOnlyHint",
        true,
      );
      expect(tools.find((tool) => tool.name === "progress_update")).toHaveProperty(
        "outputSchema.properties.checksum.type",
        "string",
      );
      const plan = await client.callTool({
        name: "progress_plan",
        arguments: {
          title: "Small task",
          outcome: "Keep the tool boundary compact",
        },
      });
      expect(plan.isError).not.toBe(true);
      const planned = Schema.decodeUnknownSync(ProgressSummarySchema)(plan.structuredContent);
      const blocked = await client.callTool({
        name: "progress_update",
        arguments: {
          id: planned.id,
          expectedChecksum: planned.checksum,
          status: "blocked",
        },
      });
      expect(blocked.structuredContent).toHaveProperty("error.code", "VALIDATION_ERROR");
      const update = await client.callTool({
        name: "progress_update",
        arguments: {
          id: planned.id,
          expectedChecksum: planned.checksum,
          status: "active",
          checkpoint: { note: "Started implementation; tests not run" },
        },
      });
      expect(update.isError).not.toBe(true);
      const stale = await client.callTool({
        name: "progress_update",
        arguments: {
          id: planned.id,
          expectedChecksum: planned.checksum,
          status: "cancelled",
        },
      });
      expect(stale.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
      const resume = await client.callTool({
        name: "progress_resume",
        arguments: { id: planned.id },
      });
      expect(resume.structuredContent).toMatchObject({
        status: "active",
        outcome: "Keep the tool boundary compact",
        checkpointCount: 1,
        verification: { state: "pending" },
        acceptanceEstablished: false,
      });
      const review = await client.callTool({ name: "progress_review", arguments: {} });
      expect(review.structuredContent).toHaveProperty("items.length", 1);
    },
    progressDefinitions,
    progressServer,
    { checksumGuard: true },
  );
});

test("coincidentally named custom definitions never gain progress intent tools", async () => {
  await withObjectFieldsClient(
    async ({ client }) => {
      expect((await client.listTools()).tools).toHaveLength(0);
    },
    [{ ...workItemDefinition, schema: BaseObjectSchema, relations: [] }],
    progressServer,
  );
});
