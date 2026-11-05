import { expect, spyOn, test } from "bun:test";
import { Schema } from "effect";
import { BaseObjectSchema } from "../src/base-schema.ts";
import { createMcpServer as createLibraryServer } from "../src/lib/mcp.ts";
import type { SourceIdentityAssurance } from "../src/lib/types.ts";
import { memoryDefinitions } from "../src/memory/registry.ts";
import { rememberMemory, reviseMemory } from "../src/memory/workflows-write.ts";
import { planProgress } from "../src/progress/mutations.ts";
import { progressDefinitions, workItemDefinition } from "../src/progress/registry.ts";
import { ProgressSummarySchema } from "../src/progress/tool-schemas.ts";
import { sessionContext } from "../src/session-context.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test("session context resumes paused work and recalls only explicitly activated knowledge", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      const planned = await client.callTool({
        name: "progress_plan",
        arguments: {
          title: "Session handoff",
          outcome: "Resume a paused deliverable without assuming tests ran",
          acceptance: ["Checkpoint history survives handoff"],
        },
      });
      expect(planned.isError).not.toBe(true);
      const initial = Schema.decodeUnknownSync(ProgressSummarySchema)(planned.structuredContent);
      const changed = await client.callTool({
        name: "progress_update",
        arguments: {
          id: initial.id,
          expectedChecksum: initial.checksum,
          status: "paused",
          checkpoint: { note: "Implementation checkpoint; verification not run" },
          nextAction: "Run focused verification when resumed",
        },
      });
      expect(changed.isError).not.toBe(true);
      const paused = Schema.decodeUnknownSync(ProgressSummarySchema)(changed.structuredContent);
      const active = await rememberMemory(framework, {
        title: "Resumable guidance",
        body: "Resumable work requires an explicit next action.",
      });
      await reviseMemory(framework, {
        id: active.stored.object.id,
        expectedChecksum: active.stored.checksum,
        changes: { status: "active" },
      });
      const draft = await rememberMemory(framework, {
        title: "Resumable draft",
        body: "Resumable speculation must remain draft.",
      });
      const result = await client.callTool({
        name: "session_context",
        arguments: { id: initial.id, query: "resumable" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        work: {
          id: initial.id,
          status: "paused",
          checksum: paused.checksum,
          outcome: initial.outcome,
          acceptance: initial.acceptance,
          checkpointCount: 1,
          verification: { state: "pending" },
          nextAction: "Run focused verification when resumed",
        },
        knowledgeRequested: true,
        knowledgeStatus: "recalled",
        knowledge: { memories: [{ id: active.stored.object.id, status: "active" }] },
      });
      expect((await framework.get("memory", draft.stored.object.id)).object).toHaveProperty(
        "status",
        "draft",
      );
      const stale = await client.callTool({
        name: "progress_update",
        arguments: {
          id: initial.id,
          expectedChecksum: initial.checksum,
          status: "active",
        },
      });
      expect(stale.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
      expect((await framework.get("work_item", initial.id)).checksum).toBe(paused.checksum);
    },
    undefined,
    undefined,
    { checksumGuard: true },
  );
});

test("omitted knowledge query does not scan memories or imply their absence", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Targeted handoff",
      outcome: "Read only requested work",
    });
    const list = spyOn(framework, "list");
    const search = spyOn(framework, "search");
    const update = spyOn(framework, "update");
    try {
      const result = await sessionContext(framework, { id: planned.id });
      expect(result.knowledge).toBeNull();
      expect(result.knowledgeRequested).toBe(false);
      expect(result.knowledgeStatus).toBe("not-requested");
      expect(result.limitations.join(" ")).toContain("not requested");
      expect(result.limitations.join(" ")).toContain("absence");
      expect(list).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      search.mockRestore();
      update.mockRestore();
    }
  });
});

test("cancelled session context performs neither a work read nor a knowledge scan", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const controller = new AbortController();
    controller.abort();
    const get = spyOn(framework, "get");
    const list = spyOn(framework, "list");
    try {
      await expect(
        sessionContext(framework, { id: "work-cancelled", query: "guidance" }, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(get).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      list.mockRestore();
    }
  });
});

test("session composition requires actual progress and memory definitions and stays out of the library", async () => {
  for (const definitions of [
    memoryDefinitions,
    progressDefinitions,
    [{ ...workItemDefinition, schema: BaseObjectSchema, relations: [] }, ...memoryDefinitions],
  ]) {
    await withObjectFieldsClient(async ({ client }) => {
      expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain(
        "session_context",
      );
    }, definitions);
  }
  await withObjectFieldsClient(
    async ({ client }) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).not.toContain("session_context");
      expect(names).not.toContain("progress_resume");
      expect(names).not.toContain("memory_recall");
    },
    [...memoryDefinitions, ...progressDefinitions],
    createLibraryServer,
  );
});

test("session context refuses an unverified work root before scanning knowledge or returning a handoff", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const planned = await planProgress(framework, {
      title: "Ambiguous handoff",
      outcome: "Do not present an unverified objective",
    });
    const stored = await framework.get("work_item", planned.id);
    const assurance: SourceIdentityAssurance = {
      complete: false,
      identity: "unverified",
      issues: [
        { path: stored.path, code: "IDENTITY_CONFLICT", message: "Source identity is ambiguous." },
      ],
    };
    const get = spyOn(framework, "get").mockResolvedValue({ ...stored, assurance });
    const list = spyOn(framework, "list");
    try {
      await expect(
        sessionContext(framework, { id: planned.id, query: "guidance" }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { id: planned.id, path: stored.path, assurance },
      });
      const result = await client.callTool({
        name: "session_context",
        arguments: { id: planned.id, query: "guidance" },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toHaveProperty(
        "error.details.assurance.identity",
        "unverified",
      );
      expect(result.structuredContent).not.toHaveProperty("work");
      expect(result.structuredContent).not.toHaveProperty("knowledge");
      expect(list).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      list.mockRestore();
    }
  });
});
