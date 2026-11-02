import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import type { ReadObject } from "../src/lib/types.ts";
import { memoryDefinitions } from "../src/memory/registry.ts";
import { registerMemoryWorkflowTools } from "../src/memory/workflows-mcp.ts";
import { memoryRecall, memoryReview } from "../src/memory/workflows-read.ts";
import { reviseMemory } from "../src/memory/workflows-write.ts";
import { memoryObject, memoryRelations } from "./helpers/memory-fixture.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

const serverFactory: Parameters<typeof withObjectFieldsClient>[2] = (framework) => {
  const server = new McpServer({ name: "memory-workflows-bounds-test", version: "1" });
  registerMemoryWorkflowTools(server, framework);
  return server;
};

test("recall budget bounds payload; review limits findings/edges without modifying sources", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      const stored = await framework.create(
        "memory",
        memoryObject({
          relations: { ...memoryRelations(), contradicts: ["one", "two", "three"] },
        }),
        "cache evidence ".repeat(1000),
      );
      const recall = await memoryRecall(framework, { query: "cache", maxChars: 1000 });
      expect(JSON.stringify(recall.memories).length).toBeLessThanOrEqual(1000);
      expect(recall.memories).toHaveLength(1);
      expect(recall).toHaveProperty("memories.0.body", expect.stringContaining("cache"));
      expect(recall).toHaveProperty("memories.0.contentTruncated", true);
      expect(recall).toHaveProperty("budget.maxChars", 1000);
      const review = await memoryReview(framework, { limit: 1, maxEdges: 2 });
      expect(review.findings).toHaveLength(1);
      expect(review.edgesExamined).toBe(2);
      expect(review.edgesTruncated).toBe(true);
      expect(review.findingsTruncated).toBe(true);
      expect(review.dateSource).toBe("server-utc");
      expect(review.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const invalid = await client.callTool({
        name: "memory_review",
        arguments: { asOf: "2026-02-30" },
      });
      expect(invalid.isError).toBe(true);
      expect(await framework.get("memory", stored.object.id)).toEqual(stored);
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("remember never merges candidates; explicit state and evidence remain caller-owned", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      await framework.create("memory", memoryObject({ title: "Cache evidence" }));
      const result = await client.callTool({
        name: "memory_remember",
        arguments: {
          title: "Cache evidence",
          body: "Observed evidence",
          status: "active",
          confidence: "medium",
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty("candidates.0.id", "memory-1");
      expect(result.structuredContent).toHaveProperty("object.status", "active");
      expect(result.structuredContent).toHaveProperty("object.confidence", "medium");
      expect((await framework.list("memory")).total).toBe(2);
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("large authored metadata does not consume recall's entire useful-content budget", async () => {
  await withObjectFieldsClient(
    async ({ framework }) => {
      await framework.create(
        "memory",
        memoryObject({
          title: "Cache evidence ".repeat(40),
          description: "Authored detail ".repeat(100),
          scope: Array.from({ length: 20 }, () => "source/".repeat(30)),
          labels: Array.from({ length: 20 }, () => "source-evidence-".repeat(20)),
        }),
        "cache evidence observed in the source",
      );
      const result = await memoryRecall(framework, { query: "cache", maxChars: 1000 });
      expect(result.memories).toHaveLength(1);
      expect(result).toHaveProperty("memories.0.body", expect.stringContaining("cache"));
      expect(result).toHaveProperty("memories.0.contentTruncated", true);
      expect(JSON.stringify(result.memories).length).toBeLessThanOrEqual(1000);
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("recall pages once per source batch, not once per rejected candidate; avoids index/model calls", async () => {
  await withObjectFieldsClient(
    async ({ framework }) => {
      const stored = await framework.create("memory", memoryObject(), "cache evidence");
      const sources = Array.from({ length: 105 }, (_, index) => ({
        ...stored,
        object: {
          ...stored.object,
          id: `source-${index}`,
          status: index === 104 ? "active" : "draft",
        },
      }));
      let pages = 0;
      const facade = new Proxy(framework, {
        get(target, property, receiver) {
          if (property === "list")
            return async (_type: string, options: { offset: number; limit: number }) => {
              pages++;
              return {
                objects: sources.slice(options.offset, options.offset + options.limit),
                total: sources.length,
              };
            };
          if (property === "search")
            return () => {
              throw new Error("Recall must not invoke indexed/model search");
            };
          return Reflect.get(target, property, receiver);
        },
      });
      const result = await memoryRecall(facade, {
        query: "cache evidence",
        maxScan: 105,
        limit: 1,
      });
      expect(result).toHaveProperty("memories.0.id", "source-104");
      expect(result).toHaveProperty("source.scanned", 105);
      expect(pages).toBe(2);
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("incomplete identity assurance stays diagnostic and blocks guarded revision", async () => {
  await withObjectFieldsClient(
    async ({ framework }) => {
      const stored = await framework.create("memory", memoryObject(), "cache evidence");
      const unsafe: ReadObject = {
        ...stored,
        assurance: {
          complete: false,
          identity: "unverified",
          issues: Array.from({ length: 30 }, () => ({
            path: stored.path,
            code: "SOURCE_ISSUE",
            message: "Diagnostic detail".repeat(100),
          })),
        },
      };
      const facade = new Proxy(framework, {
        get(target, property, receiver) {
          if (property === "list")
            return async () => ({
              objects: [unsafe],
              total: 1,
              complete: false,
              observedCount: 1,
              issues: [],
              continuation: null,
            });
          if (property === "get") return async () => unsafe;
          return Reflect.get(target, property, receiver);
        },
      });
      const recalled = await memoryRecall(facade, { query: "cache" });
      expect(recalled.memories).toHaveLength(0);
      expect(recalled).toHaveProperty("diagnostics.0.assurance.identity", "unverified");
      expect(recalled).toHaveProperty("diagnostics.0.assurance.issues.length", 3);
      expect(recalled.exhaustive).toBe(false);
      const reviewed = await memoryReview(facade, {});
      expect(reviewed.findings).toHaveLength(0);
      expect(reviewed.exhaustive).toBe(false);
      await expect(
        reviseMemory(facade, {
          id: stored.object.id,
          expectedChecksum: stored.checksum,
          body: "Replacement",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    },
    memoryDefinitions,
    serverFactory,
  );
});

test("revision merges only supplied relation arrays; review never resolves targets outside the scan", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      const stored = await framework.create(
        "memory",
        memoryObject({
          relations: {
            ...memoryRelations(),
            buildsOn: ["foundation"],
            supersedes: ["outside"],
          },
        }),
      );
      const revised = await client.callTool({
        name: "memory_revise",
        arguments: {
          id: stored.object.id,
          expectedChecksum: stored.checksum,
          changes: { relations: { relatedTo: ["topic"] } },
        },
      });
      expect(revised.isError).not.toBe(true);
      expect(revised.structuredContent).toHaveProperty("object.relations.buildsOn", ["foundation"]);
      expect(revised.structuredContent).toHaveProperty("object.relations.supersedes", ["outside"]);
      expect(revised.structuredContent).toHaveProperty("object.relations.relatedTo", ["topic"]);
      const reviewed = await memoryReview(framework, {});
      expect(reviewed.findings).toContainEqual(
        expect.objectContaining({
          kind: "supersession-target-unresolved",
          target: { id: "outside" },
        }),
      );
    },
    memoryDefinitions,
    serverFactory,
  );
});
