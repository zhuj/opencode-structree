import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { memoryDefinitions } from "../src/memory/registry.ts";
import { registerMemoryWorkflowTools } from "../src/memory/workflows-mcp.ts";
import { memoryRecall, memoryReview } from "../src/memory/workflows-read.ts";
import { memoryObject, memoryRelations } from "./helpers/memory-fixture.ts";
import { evidence, withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

const serverFactory: Parameters<typeof withObjectFieldsClient>[2] = (framework) => {
  const server = new McpServer({ name: "memory-workflows-test", version: "1" });
  registerMemoryWorkflowTools(server, framework);
  return server;
};

test("remember supplies bookkeeping without inventing approval; revise preserves omitted content", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      const remembered = await client.callTool({
        name: "memory_remember",
        arguments: {
          title: "Keep source evidence",
          body: "Only cite observed evidence.",
          scope: ["project"],
          labels: ["evidence"],
        },
      });
      expect(remembered.isError).not.toBe(true);
      expect(remembered.structuredContent).toHaveProperty(
        "object",
        expect.objectContaining({
          category: "lessons",
          status: "draft",
          confidence: "low",
          name: "Keep source evidence",
          scope: ["project"],
          labels: ["evidence"],
          retiredAt: null,
        }),
      );
      expect(remembered.structuredContent).toHaveProperty("body", "Only cite observed evidence.");
      const listed = await framework.list("memory");
      const source = listed.objects[0];
      if (!source) throw new Error("Remember did not create a source");
      expect(source.object).not.toHaveProperty("evidences");
      const revised = await client.callTool({
        name: "memory_revise",
        arguments: {
          id: source.object.id,
          expectedChecksum: source.checksum,
          changes: { labels: ["source"] },
        },
      });
      expect(revised.isError).not.toBe(true);
      expect(revised.structuredContent).toHaveProperty("body", source.body);
      expect(revised.structuredContent).toHaveProperty("object.relations", memoryRelations());
      expect(revised.structuredContent).toHaveProperty("object.labels", ["source"]);
      const stale = await client.callTool({
        name: "memory_revise",
        arguments: {
          id: source.object.id,
          expectedChecksum: source.checksum,
          changes: { status: "active" },
        },
      });
      expect(stale.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("workflow boundary rejects blank claims, empty revisions and bookkeeping injection", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      for (const args of [
        { title: " ", body: "Useful observation" },
        { title: "Useful observation", body: "\n\t" },
        { title: "Useful observation", body: "Observed", id: "injected" },
      ]) {
        expect((await client.callTool({ name: "memory_remember", arguments: args })).isError).toBe(
          true,
        );
      }
      expect((await framework.list("memory")).objects).toHaveLength(0);
      const stored = await framework.create("memory", memoryObject());
      expect(
        (
          await client.callTool({
            name: "memory_revise",
            arguments: {
              id: stored.object.id,
              expectedChecksum: stored.checksum,
              changes: {},
            },
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await client.callTool({
            name: "memory_revise",
            arguments: {
              id: stored.object.id,
              expectedChecksum: stored.checksum,
              changes: { id: "rewrite" },
            },
          })
        ).isError,
      ).toBe(true);
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("recall scans past ineligible sources before limiting eligible lexical matches", async () => {
  await withObjectFieldsClient(
    async ({ framework }) => {
      for (let index = 0; index < 3; index++)
        await framework.create(
          "memory",
          memoryObject({ id: `a-${index}`, status: "draft" }),
          "cache source evidence",
        );
      await framework.create(
        "memory",
        memoryObject({ id: "b", evidences: [evidence] }),
        "cache source evidence",
      );
      const result = await memoryRecall(framework, {
        query: "cache evidence",
        limit: 1,
        maxScan: 10,
      });
      expect(result).toHaveProperty("memories.0.id", "b");
      expect(result).toHaveProperty("memories.0.evidences.0.id", evidence.id);
      expect(result).toHaveProperty("memories.0.body", "cache source evidence");
      expect(result).toHaveProperty("source.scanned", 4);
      expect(result).toHaveProperty("exhaustive", true);
      const bounded = await memoryRecall(framework, { query: "cache", limit: 1, maxScan: 2 });
      expect(bounded).toHaveProperty("memories", []);
      expect(bounded).toHaveProperty("exhaustive", false);
      expect(bounded).toHaveProperty("source.continuation.offset", 2);
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(memoryRecall(framework, { query: "cache" }, cancelled.signal)).rejects.toThrow();
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("revise retains evidence, body and declared relations without changing relation targets", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      const target = await framework.create(
        "memory",
        memoryObject({ id: "target" }),
        "Target evidence",
      );
      const stored = await framework.create(
        "memory",
        memoryObject({
          evidences: [evidence],
          relations: { ...memoryRelations(), supersedes: ["target"] },
        }),
        "Evidence that must survive",
      );
      const result = await client.callTool({
        name: "memory_revise",
        arguments: {
          id: stored.object.id,
          expectedChecksum: stored.checksum,
          changes: { title: "New title" },
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty("object.evidences", [evidence]);
      expect(result.structuredContent).toHaveProperty("object.relations.supersedes", ["target"]);
      expect(result.structuredContent).toHaveProperty("body", stored.body);
      expect(await framework.get("memory", "target")).toEqual(target);
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("review reports declared maintenance candidates with explicit date and never writes", async () => {
  await withObjectFieldsClient(
    async ({ framework }) => {
      const a = await framework.create(
        "memory",
        memoryObject({
          id: "a",
          reviewAfter: "2026-01-01",
          relations: { ...memoryRelations(), contradicts: ["b"], supersedes: ["b"] },
        }),
        "original source",
      );
      await framework.create("memory", memoryObject({ id: "b" }), "original source");
      const result = await memoryReview(framework, { asOf: "2026-11-02" });
      expect(result).toHaveProperty("asOf", "2026-11-02");
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "overdue",
            source: expect.objectContaining({ id: "a", checksum: a.checksum }),
          }),
          expect.objectContaining({ kind: "declared-contradiction" }),
          expect.objectContaining({ kind: "duplicate-candidate" }),
          expect.objectContaining({ kind: "supersession-inconsistency" }),
        ]),
      );
      expect(await framework.get("memory", "a")).toEqual(a);
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("partial sources remain diagnostic and cannot be revised or returned as guidance", async () => {
  await withObjectFieldsClient(
    async ({ client, framework, directory }) => {
      const source = await framework.create("memory", memoryObject());
      const filename = path.join(directory, "objects", source.path);
      const raw = "---\nid: memory-1\ncategory: rules\nstatus: active\n---\nUnsafe cache advice\n";
      await writeFile(filename, raw);
      const recall = await memoryRecall(framework, { query: "cache" });
      expect(recall).toHaveProperty("memories", []);
      expect(recall).toHaveProperty("diagnostics.0.partial", true);
      const revise = await client.callTool({
        name: "memory_revise",
        arguments: {
          id: source.object.id,
          expectedChecksum: source.checksum,
          body: "replacement",
        },
      });
      expect(revise.structuredContent).toHaveProperty("error.code", "VALIDATION_ERROR");
      expect(await readFile(filename, "utf8")).toBe(raw);
    },
    memoryDefinitions,
    serverFactory,
  );
});
