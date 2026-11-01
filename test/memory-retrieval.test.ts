import { expect, test } from "bun:test";
import { Schema } from "effect";
import { BaseObjectSchema } from "../src/base-schema.ts";
import type { SearchHit, SearchRequest, StoredObject } from "../src/lib/types.ts";
import { createMcpServer } from "../src/mcp.ts";
import { memoryDefinition, memoryDefinitions } from "../src/memory/registry.ts";
import { memoryObject } from "./helpers/memory-fixture.ts";
import {
  fieldsObject,
  timestamp,
  withObjectFieldsClient,
} from "./helpers/object-fields-fixture.ts";

function hit(stored: StoredObject): SearchHit {
  return {
    type: "memory",
    id: stored.object.id,
    name: stored.object.name,
    title: stored.object.title,
    path: stored.path,
    checksum: stored.checksum,
    score: 1,
    fulltextRank: 1,
    semanticDistance: null,
    matchedChunk: null,
    fulltextExcerpt: "Bounded lexical evidence",
  };
}

test("search uses memory-only fulltext then filters bounded candidates, without refill", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const draft = await framework.create("memory", memoryObject({ id: "draft", status: "draft" }));
    const active = await framework.create(
      "memory",
      memoryObject({ id: "active", category: "rules" }),
    );
    const retired = await framework.create(
      "memory",
      memoryObject({ id: "retired", retiredAt: timestamp }),
    );
    const requests: SearchRequest[] = [];
    framework.search = async (request, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      requests.push(request);
      return {
        mode: request.mode ?? "fulltext",
        indexGeneration: 7,
        hits: [hit(draft), hit(active), hit(retired)],
      };
    };
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "evidence", top_n: "3", category: "rules", label: "retrieval" },
    });
    expect(result.isError).not.toBe(true);
    expect(requests).toEqual([{ query: "evidence", topN: 3, mode: "fulltext", types: ["memory"] }]);
    expect(result._meta).toHaveProperty("object-mcp/input-repair.repairs");
    expect(result.structuredContent).toMatchObject({
      mode: "fulltext",
      indexGeneration: 7,
      filtering: { stage: "after-topN", refill: false, exhaustive: false, candidates: 3 },
    });
    expect(result.structuredContent).toHaveProperty("hits.length", 1);
    expect(result.structuredContent).toHaveProperty(
      "hits.0.memory",
      expect.objectContaining({
        id: "active",
        category: "rules",
        currentGuidance: true,
        reviewDue: null,
      }),
    );
    expect(result.structuredContent).toHaveProperty(
      "hits.0.fulltextExcerpt",
      "Bounded lexical evidence",
    );
    const filtered = await client.callTool({
      name: "memory_search",
      arguments: { query: "evidence", status: "draft", mode: "semantic", includeBody: true },
    });
    expect(requests[1]).toEqual({
      query: "evidence",
      mode: "semantic",
      types: ["memory"],
      includeBody: true,
    });
    expect(filtered.structuredContent).toHaveProperty("hits.0.memory.currentGuidance", false);
    const empty = await client.callTool({
      name: "memory_search",
      arguments: { query: "evidence", category: "security", topN: 1 },
    });
    expect(empty.structuredContent).toHaveProperty("hits", []);
    expect(requests).toHaveLength(3);
    const blank = await client.callTool({ name: "memory_search", arguments: { query: " \n " } });
    expect(blank.isError).toBe(true);
    expect(requests).toHaveLength(3);
  }, memoryDefinitions);
});

test("partial and changed search candidates stay diagnostic, preserving source-search limits", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const stored = await framework.create("memory", memoryObject());
    const partial: SearchHit = {
      ...hit(stored),
      id: "partial",
      partial: true,
      object: { id: "partial", status: "active" },
      identity: { source: "filename", type: "memory", id: "partial" },
      issues: [{ code: "INVALID_FRONTMATTER", message: "Incomplete metadata" }],
    };
    framework.search = async () => ({
      mode: "source",
      requestedMode: "fulltext",
      indexGeneration: null,
      complete: false,
      observedCount: 4,
      issues: [{ path: "other.md", code: "SCAN", message: "Unreadable source" }],
      recovery: { state: "degraded", code: "SOURCE_ONLY" },
      hits: [partial, { ...hit(stored), checksum: "old" }],
    });
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "evidence" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      mode: "source",
      complete: false,
      observedCount: 4,
      hits: [],
      indexGeneration: null,
      recovery: { code: "SOURCE_ONLY" },
    });
    expect(result.structuredContent).toHaveProperty("diagnostics.0.partial", true);
    expect(result.structuredContent).toHaveProperty(
      "diagnostics.1.issues.0.code",
      "REVISION_CHANGED",
    );
    expect(result.structuredContent).toHaveProperty("issues.0.code", "SCAN");
  }, memoryDefinitions);
});

test("incomplete source page retains null total, issues, observed count and continuation", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const stored = await framework.create("memory", memoryObject());
    framework.list = async (_type, options, signal) => {
      expect(_type).toBe("memory");
      expect(options).toEqual({ limit: 2, offset: 8 });
      expect(signal).toBeInstanceOf(AbortSignal);
      return {
        objects: [stored],
        complete: false,
        total: null,
        observedCount: 13,
        issues: [{ path: "unreadable.md", code: "SCAN", message: "Source scan incomplete" }],
        continuation: { offset: 10 },
      };
    };
    const result = await client.callTool({
      name: "memory_context",
      arguments: { offset: 8, limit: 2 },
    });
    expect(result.structuredContent).toHaveProperty("source", {
      offset: 8,
      limit: 2,
      returned: 1,
      total: null,
      complete: false,
      observedCount: 13,
      issues: [{ path: "unreadable.md", code: "SCAN", message: "Source scan incomplete" }],
      continuation: { offset: 10 },
    });
    expect(result.structuredContent).toHaveProperty("matchingTotal", null);
  }, memoryDefinitions);
});

test("unverified source identity is not current guidance even on an active valid memory", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const stored = await framework.create("memory", memoryObject());
    const assurance = {
      complete: false as const,
      identity: "unverified" as const,
      issues: [{ path: "blocked.md", code: "SCAN", message: "Identity scan incomplete" }],
    };
    framework.list = async () => ({
      objects: [{ ...stored, assurance }],
      total: null,
      complete: false,
      observedCount: 1,
      issues: assurance.issues,
      continuation: null,
    });
    const result = await client.callTool({ name: "memory_context", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty("memories.0.currentGuidance", false);
    expect(result.structuredContent).toHaveProperty("memories.0.assurance", assurance);
  }, memoryDefinitions);
});

test("native memory fulltext keeps lexical behavior and excludes other object types", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    await framework.create("memory", memoryObject(), "Uniquecontent café token.");
    await framework.create("project", fieldsObject("project"), "Uniquecontent café token.");
    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "UNIQUECONTENT CAFE" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty("hits.length", 1);
    expect(result.structuredContent).toHaveProperty("hits.0.type", "memory");
    expect(result.structuredContent).toHaveProperty("hits.0.fulltextExcerpt", expect.any(String));
    expect(result.structuredContent).toHaveProperty("hits.0.matchedChunk", null);
    expect((result.structuredContent as { hits: object[] }).hits[0]).not.toHaveProperty("body");
  });
});

test("custom types named memory do not gain specialized tools without the actual memory schema and descriptors", async () => {
  for (const definition of [
    {
      name: "memory",
      directory: "notes",
      description: "Independent custom type",
      schema: Schema.Struct(BaseObjectSchema.fields),
    },
    { ...memoryDefinition, relations: [] },
  ])
    await withObjectFieldsClient(
      async ({ client }) => {
        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toContain("memory_create");
        for (const name of [
          "memory_context",
          "memory_search",
          "memory_related",
          "memory_set_status",
        ])
          expect(names).not.toContain(name);
      },
      [definition],
      createMcpServer,
    );
});
