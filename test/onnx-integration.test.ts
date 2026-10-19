import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFramework, type ObjectFramework } from "../src/framework.ts";
import { loadConfig } from "../src/lib/config.ts";
import { createMcpServer } from "../src/lib/mcp.ts";
import type { SearchResponse, StoredObject, SyncReport } from "../src/lib/types.ts";

const onnxConfigFile = process.env.OBJECT_MCP_ONNX_TEST_CONFIG;

test.skipIf(!onnxConfigFile)(
  "actual ONNX → filesystem → sqlite-vec → official MCP retrieval",
  async () => {
    const config = await loadConfig(onnxConfigFile!);
    if (config.embeddings.provider !== "onnx")
      throw new Error("ONNX integration requires an ONNX configuration");
    const directory = await mkdtemp(path.join(os.tmpdir(), "object-mcp-onnx-integration-"));
    let framework: ObjectFramework | undefined;
    let handler: ReturnType<typeof createMcpHandler> | undefined;
    let client: Client | undefined;
    try {
      framework = await createFramework({
        baseDirectory: directory,
        config: {
          root: "objects",
          sqlite: { driver: "better-sqlite3", path: "cache/index.sqlite" },
          embeddings: { ...config.embeddings, localFilesOnly: true },
          chunking: { size: 1200, overlap: 0.1 },
          sync: { watch: false, debounceMs: 60_000, rescanIntervalMs: 0 },
        },
      });
      const facade = framework;
      handler = createMcpHandler(() => createMcpServer(facade));
      const mcpHandler = handler;
      client = new Client(
        { name: "real-onnx-integration", version: "1.0.0" },
        { versionNegotiation: { mode: "auto" } },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://onnx-integration.test/mcp"), {
          fetch: (input, init) => mcpHandler.fetch(new Request(input, init)),
        }),
      );
      const mcpClient = client;
      const createdAt = "2026-10-15T12:00:00.000Z";
      const base = (id: string, title: string, description: string) => ({
        id,
        name: id,
        title,
        description,
        createdAt,
        updatedAt: createdAt,
        retiredAt: null,
        tags: {},
        metadata: {},
      });
      const watchedBody =
        "# Local Markdown monitoring\n\n" +
        (
          "The plugin watches local Markdown files and directories. When a document is edited, " +
          "the filesystem watcher sends a change notification. The plugin rereads the Markdown " +
          "and synchronizes its searchable cache. Startup reconciliation detects missed file updates.\n\n"
        ).repeat(7);
      const cookingBody =
        "# Vegetable recipes\n\nRoast carrots and potatoes in the oven with olive oil, herbs, and salt. " +
        "Serve the roasted vegetables with a lemon dressing. This cookbook organizes recipes and ingredients.\n";
      const featureBody =
        "# Change notifications\n\nDetect edits to local Markdown documents with filesystem watchers. " +
        "Notify the plugin about modified, renamed, and deleted files so the search cache remains synchronized.\n";
      const inputs = [
        {
          type: "project",
          object: {
            ...base(
              "watch-project",
              "Local Markdown file watcher",
              "Detect local Markdown edits and synchronize filesystem objects.",
            ),
            relations: { partOf: null },
          },
          body: watchedBody,
        },
        {
          type: "project",
          object: {
            ...base(
              "cooking-project",
              "Vegetable roasting recipe book",
              "Recipes for cooking vegetables in the oven.",
            ),
            relations: { partOf: null },
          },
          body: cookingBody,
        },
        {
          type: "feature",
          object: {
            ...base(
              "watch-feature",
              "Markdown file change notifications",
              "Notify the plugin when local Markdown documents are edited.",
            ),
            relations: { project: "watch-project", commitment: { goals: [] } },
          },
          body: featureBody,
        },
      ];
      const checksums = new Map<string, string>();
      for (const input of inputs) {
        const result = await mcpClient.callTool({
          name: `${input.type}_create`,
          arguments: { object: input.object, body: input.body },
        });
        expect(result.isError).not.toBe(true);
        const created = result.structuredContent as unknown as StoredObject;
        checksums.set(created.object.id, created.checksum);
        const raw = await readFile(path.join(directory, "objects", created.path), "utf8");
        expect(raw).toContain(`id: ${input.object.id}`);
        expect(raw.endsWith(input.body)).toBe(true);
      }
      const resync = await mcpClient.callTool({ name: "objects_resync", arguments: {} });
      expect(resync.isError).not.toBe(true);
      const report = resync.structuredContent as unknown as SyncReport;
      expect(report.scanned).toBe(3);
      expect(report.issues).toEqual([]);
      const status = await mcpClient.callTool({ name: "objects_status", arguments: {} });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({
        driver: "better-sqlite3",
        objects: 3,
        embeddedObjects: 3,
        pendingEmbeddings: 0,
      });
      expect((status.structuredContent as { embeddingRows: number }).embeddingRows).toBeGreaterThan(
        6,
      );
      expect((status.structuredContent as { vectorVersion: string }).vectorVersion).toMatch(
        /0\.1\./,
      );

      async function search(arguments_: Record<string, unknown>): Promise<SearchResponse> {
        const result = await mcpClient.callTool({ name: "objects_search", arguments: arguments_ });
        expect(result.isError).not.toBe(true);
        return result.structuredContent as unknown as SearchResponse;
      }

      const query =
        config.embeddings.model === "Xenova/multilingual-e5-small"
          ? "Как плагин узнаёт об изменении локальных файлов Markdown?"
          : "How does the plugin detect edits to local Markdown files?";
      const projects = await search({
        query,
        mode: "semantic",
        types: ["project"],
        topN: 1,
        includeBody: true,
      });
      expect(projects.hits.map((hit) => [hit.type, hit.id])).toEqual([
        ["project", "watch-project"],
      ]);
      expect(projects.hits[0]!.body).toBe(watchedBody);
      expect(projects.hits[0]!.checksum).toBe(checksums.get("watch-project")!);
      expect(Number.isFinite(projects.hits[0]!.semanticDistance)).toBe(true);
      expect(projects.hits[0]!.matchedChunk).not.toBeNull();

      // Both disjoint type selections must find an object even when global top-1 belongs to the other type.
      const features = await search({ query, mode: "semantic", types: ["feature"], topN: 1 });
      expect(features.hits.map((hit) => [hit.type, hit.id])).toEqual([
        ["feature", "watch-feature"],
      ]);
      const combined = await search({
        query,
        mode: "semantic",
        types: ["project", "feature"],
        topN: 2,
      });
      expect(combined.hits).toHaveLength(2);
      expect(combined.hits.map((hit) => hit.id).sort()).toEqual(["watch-feature", "watch-project"]);
      expect(new Set(combined.hits.map((hit) => `${hit.type}/${hit.id}`)).size).toBe(2);
      expect((await search({ query, mode: "semantic", types: [], topN: 1 })).hits).toEqual([]);

      const hybrid = await search({
        query: "Markdown",
        mode: "hybrid",
        types: ["project"],
        topN: 1,
      });
      expect(hybrid.hits.map((hit) => hit.id)).toEqual(["watch-project"]);
      expect(hybrid.hits[0]!.fulltextRank).not.toBeNull();
      expect(hybrid.hits[0]!.semanticDistance).not.toBeNull();
      const fulltext = await search({
        query: "roast",
        mode: "fulltext",
        types: ["project"],
        topN: 1,
      });
      expect(fulltext.hits.map((hit) => hit.id)).toEqual(["cooking-project"]);
    } finally {
      await client?.close();
      await handler?.close();
      await framework?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
