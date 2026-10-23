import { describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { defineConfig } from "../src/lib/config.ts";
import { FrameworkError } from "../src/lib/errors";
import { objectKey } from "../src/lib/filesystem.ts";
import {
  createMcpServer,
  effectMcpSchema,
  type McpToolOptions,
  registerObjectTools,
} from "../src/lib/mcp";
import type {
  FrameworkConfig,
  ObjectFacade,
  RelationsRequest,
  RelationsResponse,
  SearchHit,
  SearchRequest,
  SearchResponse,
  StoredObject,
  SyncReport,
} from "../src/lib/types";
import { coreDefinitions, createCoreRegistry } from "../src/registry";

const projectJson = () => ({
  id: "p-1",
  name: "demo",
  title: "Demo project",
  description: "A project",
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  retiredAt: null,
  tags: { language: "en" },
  metadata: { nested: { active: true } },
  relations: { partOf: null },
});

class MemoryFacade implements ObjectFacade {
  readonly definitions = coreDefinitions;
  config?: Pick<FrameworkConfig, "mcp"> & Partial<Pick<FrameworkConfig, "search">>;
  readonly objects = new Map<string, StoredObject>();
  readonly registry = createCoreRegistry();
  lastSignal: AbortSignal | undefined;
  lastSearch: SearchRequest | undefined;
  lastRelations: RelationsRequest | undefined;
  createdWithDate = false;
  closed = 0;
  beforeGet: ((signal?: AbortSignal) => Promise<void>) | undefined;
  beforeCreate: ((value: unknown) => Promise<void>) | undefined;
  private revision = 0;

  async create(
    type: string,
    value: unknown,
    body = "",
    signal?: AbortSignal,
  ): Promise<StoredObject> {
    this.lastSignal = signal;
    await this.beforeCreate?.(value);
    this.createdWithDate = (value as { createdAt: unknown }).createdAt instanceof Date;
    const object = this.registry.decode(type, value);
    const key = objectKey(type, object.id);
    if (this.objects.has(key))
      throw new FrameworkError("CONFLICT", "The object already exists.", { id: object.id });
    const stored = {
      type,
      object,
      body,
      path: `${type}/example.md`,
      checksum: `revision-${++this.revision}`,
    };
    this.objects.set(key, stored);
    return stored;
  }

  async get(type: string, id: string, signal?: AbortSignal): Promise<StoredObject> {
    this.lastSignal = signal;
    await this.beforeGet?.(signal);
    const stored = this.objects.get(objectKey(type, id));
    if (!stored) throw new FrameworkError("NOT_FOUND", "The object does not exist.", { type, id });
    return stored;
  }

  async update(
    type: string,
    id: string,
    value: unknown,
    body: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<StoredObject> {
    const old = await this.get(type, id, signal);
    if (old.checksum !== expectedChecksum)
      throw new FrameworkError("CHECKSUM_CONFLICT", "The file has changed.");
    const object = this.registry.decode(type, value);
    const stored = { ...old, object, body, checksum: `revision-${++this.revision}` };
    this.objects.set(objectKey(type, id), stored);
    return stored;
  }

  async delete(
    type: string,
    id: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<{ type: string; id: string; deleted: true }> {
    const old = await this.get(type, id, signal);
    if (old.checksum !== expectedChecksum)
      throw new FrameworkError("CHECKSUM_CONFLICT", "The file has changed.");
    this.objects.delete(objectKey(type, id));
    return { type, id, deleted: true };
  }

  async list(
    type: string,
    options: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<{ objects: readonly StoredObject[]; total: number }> {
    this.lastSignal = signal;
    const objects = [...this.objects.values()]
      .filter((object) => object.type === type)
      .sort((a, b) => a.object.id.localeCompare(b.object.id));
    const offset = options.offset ?? 0;
    return {
      objects: objects.slice(offset, offset + (options.limit ?? 100)),
      total: objects.length,
    };
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    this.lastSignal = signal;
    this.lastSearch = request;
    return { mode: request.mode ?? "hybrid", hits: [], indexGeneration: 2 };
  }

  async relations(request: RelationsRequest, signal?: AbortSignal): Promise<RelationsResponse> {
    this.lastSignal = signal;
    this.lastRelations = request;
    return {
      root: { type: request.type, id: request.id, name: "demo", title: "Demo" },
      mode: request.mode ?? "neighbors",
      edges: [],
      affected: [],
      findings: [],
      totalEdges: 0,
      truncated: false,
      findingsTotal: 0,
      findingsTruncated: false,
    };
  }

  async resync(signal?: AbortSignal): Promise<SyncReport> {
    this.lastSignal = signal;
    return {
      scanned: this.objects.size,
      indexed: 0,
      unchanged: this.objects.size,
      deleted: 0,
      issues: [],
      generation: 2,
    };
  }

  status(): Record<string, unknown> {
    return { objects: this.objects.size, embeddings: "disabled" };
  }
  async close(): Promise<void> {
    this.closed++;
  }
}

async function connected<A>(
  run: (client: Client, facade: MemoryFacade) => Promise<A>,
  facade = new MemoryFacade(),
  factory: (facade: MemoryFacade) => McpServer = createMcpServer,
): Promise<A> {
  const handler = createMcpHandler(() => factory(facade));
  const client = new Client(
    { name: "object-mcp-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = new StreamableHTTPClientTransport(new URL("http://object-mcp.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  try {
    await client.connect(transport);
    return await run(client, facade);
  } finally {
    await client.close();
    await handler.close();
  }
}

describe("official MCP adapter", () => {
  test("partial search hits require metadata after type narrowing and complete hits remain compatible", () => {
    const complete = {
      type: "project",
      id: "p-1",
      name: "demo",
      title: "Demo",
      path: "project.md",
      checksum: "revision-1",
      score: 1,
      fulltextRank: 1,
      semanticDistance: null,
      matchedChunk: null,
    };
    const rejectsMissingMetadata: typeof complete & { partial: true } extends SearchHit
      ? false
      : true = true;
    expect(rejectsMissingMetadata).toBe(true);
    const summary = (hit: SearchHit): string => {
      if (hit.partial)
        return `${hit.identity.type}:${hit.identity.id}:${hit.object.id}:${hit.issues.length}`;
      return hit.id;
    };
    expect(summary(complete)).toBe("p-1");
    expect(
      summary({
        ...complete,
        partial: true,
        object: { id: "p-1" },
        identity: { source: "filename", id: "p-1", type: "project" },
        issues: [],
      }),
    ).toBe("project:p-1:p-1:0");
  });

  test("search output rejects incomplete partial metadata instead of accepting the complete branch", async () => {
    const facade = new MemoryFacade();
    const hit = {
      type: "project",
      id: "p-1",
      name: "demo",
      title: "Demo",
      path: "project.md",
      checksum: "revision-1",
      score: 1,
      fulltextRank: 1,
      semanticDistance: null,
      matchedChunk: null,
    };
    const metadata = {
      object: { id: "p-1" },
      identity: { source: "filename", id: "p-1", type: "project" },
      issues: [],
    };
    let supplied: Record<string, unknown> = {};
    // A custom facade can violate its declared contract at runtime. The MCP output
    // boundary must reject that payload rather than silently matching a wider branch.
    facade.search = async () => ({
      mode: "fulltext",
      hits: [{ ...hit, ...supplied }],
      indexGeneration: 2,
    });
    await connected(async (client) => {
      for (const fields of [
        { partial: true },
        { partial: true, object: metadata.object, identity: metadata.identity },
        { partial: true, object: metadata.object, issues: metadata.issues },
        { partial: true, identity: metadata.identity, issues: metadata.issues },
      ]) {
        supplied = fields;
        const response = await client.callTool({
          name: "objects_search",
          arguments: { query: "demo" },
        });
        expect(response.isError).toBe(true);
        expect(JSON.stringify(response.content)).toContain("Output validation error");
      }
      for (const fields of [{}, { partial: true, ...metadata }]) {
        supplied = fields;
        const response = await client.callTool({
          name: "objects_search",
          arguments: { query: "demo" },
        });
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent).toHaveProperty("hits.0.id", "p-1");
        if ("partial" in fields)
          expect(response.structuredContent).toHaveProperty("hits.0.identity", metadata.identity);
        else expect(response.structuredContent).not.toHaveProperty("hits.0.partial");
      }
    }, facade);
  });
  test("advertises optional string-or-null lexical excerpts and validates supplied or absent fields", async () => {
    const facade = new MemoryFacade();
    const hit = {
      type: "project",
      id: "p-1",
      name: "demo",
      title: "Demo",
      path: "project.md",
      checksum: "revision-1",
      score: 1,
      fulltextRank: 1,
      semanticDistance: null,
      matchedChunk: null,
    };
    let supplied: Record<string, unknown> = {};
    facade.search = async () => ({
      mode: "fulltext",
      hits: [{ ...hit, ...supplied }],
      indexGeneration: 2,
    });
    await connected(async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(65);
      const search = tools.find((tool) => tool.name === "objects_search")!;
      for (const branch of [0, 1]) {
        const prefix = `properties.hits.items.anyOf.${branch}`;
        expect(search.outputSchema).toHaveProperty(
          `${prefix}.required`,
          expect.not.arrayContaining(["fulltextExcerpt"]),
        );
        expect(search.outputSchema).toHaveProperty(
          `${prefix}.properties.fulltextExcerpt.anyOf`,
          expect.arrayContaining([{ type: "string" }, { type: "null" }]),
        );
      }
      expect(search.outputSchema).toHaveProperty(
        "properties.hits.items.anyOf.0.properties.partial.enum",
        [false],
      );
      expect(search.outputSchema).toHaveProperty(
        "properties.hits.items.anyOf.1.required",
        expect.arrayContaining(["partial", "object", "identity", "issues"]),
      );
      expect(search.description).toContain(
        "`fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.",
      );
      for (const value of [undefined, null, "raw evidence"]) {
        supplied = value === undefined ? {} : { fulltextExcerpt: value };
        const response = await client.callTool({
          name: "objects_search",
          arguments: { query: "evidence", mode: "fulltext" },
        });
        expect(response.isError).not.toBe(true);
        const returned = (response.structuredContent as { hits: Record<string, unknown>[] })
          .hits[0]!;
        expect(returned.fulltextExcerpt).toBe(value);
        expect(returned).not.toHaveProperty("body");
        expect(returned.matchedChunk).toBeNull();
      }
      for (const value of [12, {}, [], false]) {
        supplied = { fulltextExcerpt: value };
        const response = await client.callTool({
          name: "objects_search",
          arguments: { query: "evidence" },
        });
        expect(response.isError).toBe(true);
        expect(JSON.stringify(response.content)).toContain("Output validation error");
      }
      const chunk = { index: 1, start: 9, end: 14, text: "🚀text" };
      facade.search = async () => ({
        mode: "hybrid",
        hits: [
          {
            ...hit,
            fulltextRank: null,
            fulltextExcerpt: null,
            semanticDistance: 0.2,
            matchedChunk: chunk,
          },
        ],
        indexGeneration: 2,
      });
      const semanticOnly = await client.callTool({
        name: "objects_search",
        arguments: { query: "evidence", mode: "hybrid" },
      });
      expect(semanticOnly.isError).not.toBe(true);
      expect(semanticOnly.structuredContent).toHaveProperty("hits.0.fulltextExcerpt", null);
      expect(semanticOnly.structuredContent).toHaveProperty("hits.0.matchedChunk", chunk);
      expect((semanticOnly.structuredContent as { hits: unknown[] }).hits[0]).not.toHaveProperty(
        "body",
      );
    }, facade);
  });

  test("attaches the generated tools to an existing host server without replacing its tools", async () => {
    const facade = new MemoryFacade();
    await connected(
      async (client) => {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(66);
        expect(tools.some((tool) => tool.name === "host_ping")).toBe(true);
        expect(tools.some((tool) => tool.name === "project_create")).toBe(true);
        expect(tools.some((tool) => tool.name === "objects_search")).toBe(true);
        const hostResult = await client.callTool({ name: "host_ping", arguments: {} });
        expect(hostResult.content).toEqual([{ type: "text", text: "pong" }]);
        const created = await client.callTool({
          name: "project_create",
          arguments: { object: projectJson() },
        });
        expect(created.isError).not.toBe(true);
        expect(created.structuredContent).toHaveProperty("body", "");
      },
      facade,
      (objects) => {
        const server = new McpServer({ name: "existing-plugin", version: "1.0.0" });
        server.registerTool(
          "host_ping",
          { inputSchema: effectMcpSchema(Schema.Struct({})) },
          () => ({ content: [{ type: "text", text: "pong" }] }),
        );
        registerObjectTools(server, objects);
        return server;
      },
    );
    expect(facade.closed).toBe(0);
  });

  test("advertises all 65 tools with schema-derived required fields and optional wrapper keys", async () => {
    await connected(async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(65);
      for (const definition of coreDefinitions) {
        for (const operation of ["create", "get", "update", "delete", "list"]) {
          expect(tools.some((tool) => tool.name === `${definition.name}_${operation}`)).toBe(true);
        }
      }
      const create = tools.find((tool) => tool.name === "project_create")!;
      const schema = create.inputSchema;
      expect(schema).toHaveProperty(
        "properties.object.description",
        "The complete object. Identifiers are lowercased and must be portable file names.",
      );
      expect(create.description).toContain(
        "Identifiers are lowercased and must be portable file names.",
      );
      const get = tools.find((tool) => tool.name === "project_get")!;
      const update = tools.find((tool) => tool.name === "project_update")!;
      const remove = tools.find((tool) => tool.name === "project_delete")!;
      expect(get.inputSchema).toHaveProperty(
        "properties.id.description",
        "Object identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
      );
      expect(update.inputSchema).toHaveProperty(
        "properties.id.description",
        "Object identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
      );
      expect(remove.inputSchema).toHaveProperty(
        "properties.id.description",
        "Object identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
      );
      expect(update.inputSchema).toHaveProperty(
        "properties.object.description",
        "The complete object. Identifiers are lowercased and must be portable file names.",
      );
      expect(update.description).toContain(
        "Identifiers are lowercased and must be portable file names.",
      );
      expect(schema.required).toEqual(["object"]);
      expect(schema.additionalProperties).toBe(false);
      expect(schema).toHaveProperty("properties.body.type", "string");
      expect(schema).toHaveProperty("properties.object.properties.createdAt.type", "string");
      expect(schema).toHaveProperty(
        "properties.object.required",
        expect.arrayContaining(["retiredAt"]),
      );
      expect(schema).toHaveProperty("properties.object.properties.relations.required", ["partOf"]);
      const result = await client.callTool({ name: "objects_definitions", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty("definitions.length", 12);
      for (const name of ["objects_status", "objects_resync", "objects_definitions"]) {
        const tool = tools.find((entry) => entry.name === name)!;
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.additionalProperties).toBe(false);
        const extra = await client.callTool({ name, arguments: { unexpected: true } });
        expect(extra.isError).toBe(true);
      }
    });
  });

  test("advertises the list bounds, the configured search bounds, and the registered type names", async () => {
    const facade = new MemoryFacade();
    facade.config = defineConfig({ search: { maxTopN: 42, defaultTopN: 7 } });
    await connected(async (client) => {
      const { tools } = await client.listTools();
      const list = tools.find((tool) => tool.name === "project_list")!;
      expect(list.inputSchema).toHaveProperty("properties.limit.minimum", 1);
      expect(list.inputSchema).toHaveProperty("properties.limit.maximum", 1000);
      expect(list.inputSchema).toHaveProperty(
        "properties.limit.description",
        "Maximum objects to return, 1 to 1000. Defaults to 50.",
      );
      expect(list.inputSchema).toHaveProperty("properties.offset.minimum", 0);
      expect(list.inputSchema).toHaveProperty(
        "properties.offset.description",
        "Number of objects to skip in identifier order. Defaults to 0.",
      );
      const search = tools.find((tool) => tool.name === "objects_search")!;
      expect(search.inputSchema).toHaveProperty("properties.topN.minimum", 1);
      expect(search.inputSchema).toHaveProperty("properties.topN.maximum", 42);
      expect(search.inputSchema).toHaveProperty(
        "properties.topN.description",
        "Maximum number of distinct matching objects, 1 to 42. Defaults to 7.",
      );
      expect(search.inputSchema).toHaveProperty(
        "properties.mode.description",
        'Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.',
      );
      expect(search.inputSchema).toHaveProperty(
        "properties.types.items.enum",
        coreDefinitions.map((definition) => definition.name),
      );
    }, facade);
  });

  test("advertises the default search bounds when the facade exposes no configuration", async () => {
    await connected(async (client) => {
      const { tools } = await client.listTools();
      const search = tools.find((tool) => tool.name === "objects_search")!;
      expect(search.inputSchema).toHaveProperty("properties.topN.maximum", 100);
      expect(search.inputSchema).toHaveProperty(
        "properties.topN.description",
        "Maximum number of distinct matching objects, 1 to 100. Defaults to 10.",
      );
    });
  });

  for (const configured of [false, true]) {
    test(`advertises truthful search and status guidance (configured: ${configured})`, async () => {
      const facade = new MemoryFacade();
      if (configured) facade.config = defineConfig({ search: { maxTopN: 42, defaultTopN: 7 } });
      await connected(async (client) => {
        const { tools } = await client.listTools();
        const search = tools.find((tool) => tool.name === "objects_search")!;
        expect(search.inputSchema).toHaveProperty(
          "properties.query.description",
          "Nonblank search text. Fulltext and hybrid's lexical component require all extracted Unicode letter/number/mark tokens (AND), with SQLite case/diacritic folding and no stemming. Punctuation separates tokens; quotes and * do not enable phrase or prefix search. AND, OR and NOT are literal required words, not operators. Lexical evaluation accepts at most 128 distinct extracted tokens before folding; more fails with an INTERNAL error, while punctuation-only text yields no lexical matches. Lexical search covers name, title and raw Markdown, including YAML frontmatter and body.",
        );
        expect(search.inputSchema).toHaveProperty(
          "properties.types.description",
          "Restrict both lexical and semantic candidates to these registered types before ranking limits. Omit for all types; [] searches none. Type and directory names are not added to searchable text. Use the type's list tool to enumerate objects without a content query.",
        );
        expect(search.inputSchema).toHaveProperty(
          "properties.mode.description",
          'Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; the local ONNX provider fetches its pinned model snapshot at startup when the snapshot is missing and downloads are permitted. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. In hybrid mode a query with no lexical tokens still runs the semantic ranking, and those hits carry no lexical evidence. Valid requests with types: [] return no hits without invoking a provider.',
        );
        expect(search.description).toBe(
          "Search distinct objects in the derived SQLite index using full-text, semantic or hybrid ranking, including readable partial documents. Missing or malformed frontmatter does not by itself exclude a document; partial hits expose recovered fields, identity origin and issues. Display label fallbacks are derived, not validated source facts. Search is not exhaustive: topN is a maximum, recent objects may be absent, and stale or unreadable candidates are omitted without refill. Use the type's get tool for a known id and fully paginate its source-backed list to enumerate readable objects. The server's startup reconciliation runs in the background, so a search issued right after it starts may find nothing; objects_status reports whether a synchronization is still running. The body field is omitted unless includeBody is true; search never returns a dedicated raw field. `fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.",
        );
        expect(tools.find((tool) => tool.name === "objects_status")?.description).toBe(
          "Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.",
        );
      }, facade);
    });
  }

  test("objects_definitions filters by type, lists every type, and publishes the workflow", async () => {
    await connected(async (client) => {
      const all = await client.callTool({ name: "objects_definitions", arguments: {} });
      expect(all.isError).not.toBe(true);
      expect(all.structuredContent).toHaveProperty("definitions.length", 12);
      const guidance = (all.structuredContent as { guidance: string[] }).guidance;
      expect(guidance).toHaveLength(9);
      expect(guidance[0]).toBe(
        "Object ids are stable and unique within their type. Reads prefer a usable frontmatter id; otherwise a lowercase filename stem supplies an explicitly inferred identity. The scanner may align filenames only for validated objects, never for partial documents.",
      );
      expect(guidance[1]).toContain("includeBody:false listings omit both body and raw");
      expect(guidance[3]).toContain("create/update inputs remain complete and schema-validated");
      expect(guidance[7]).toBe(
        "Search is not exhaustive: it is capped by topN and can miss a stale hit, so confirm a known id with get.",
      );
      expect(guidance[8]).toBe(
        "Use objects_relations to answer what a change reaches and what justifies an object; it is the exact path for relation questions, where search is a heuristic.",
      );
      const single = await client.callTool({
        name: "objects_definitions",
        arguments: { type: "project" },
      });
      expect(single.isError).not.toBe(true);
      expect(single.structuredContent).toHaveProperty("definitions.length", 1);
      expect(single.structuredContent).toHaveProperty("definitions.0.name", "project");
      expect(single.structuredContent).toHaveProperty("guidance.length", 9);
      const unknown = await client.callTool({
        name: "objects_definitions",
        arguments: { type: "does_not_exist" },
      });
      expect(unknown.isError).toBe(true);
      expect(unknown.structuredContent).toHaveProperty("error.code", "UNKNOWN_TYPE");
    });
  });

  test("per-type tool descriptions point at the published workflow", async () => {
    await connected(async (client) => {
      const { tools } = await client.listTools();
      for (const operation of ["create", "get", "update", "delete", "list"]) {
        const tool = tools.find((entry) => entry.name === `project_${operation}`)!;
        expect(tool.description).toContain(
          "See objects_definitions for the object model and workflow.",
        );
      }
      const list = tools.find((tool) => tool.name === "project_list")!;
      expect(list.description).toContain(
        "A retired object is still listed; check its retiredAt field to exclude it.",
      );
      expect(list.description).toContain(
        "Set includeBody to false to omit the Markdown body; reduced listings also omit partial raw content, which remains available on direct get.",
      );
      expect(list.inputSchema).toHaveProperty("properties.includeBody.type", "boolean");
    });
  });

  test("list omits the body only when includeBody is false", async () => {
    await connected(async (client) => {
      const created = await client.callTool({
        name: "project_create",
        arguments: { object: projectJson(), body: "# Body" },
      });
      expect(created.isError).not.toBe(true);
      const listed = await client.callTool({ name: "project_list", arguments: {} });
      const objects = (listed.structuredContent as { objects: Record<string, unknown>[] }).objects;
      expect(objects[0]).toHaveProperty("body", "# Body");
      const compact = await client.callTool({
        name: "project_list",
        arguments: { includeBody: false },
      });
      expect(compact.isError).not.toBe(true);
      const compactObjects = (
        compact.structuredContent as {
          objects: Record<string, unknown>[];
        }
      ).objects;
      expect(compactObjects[0]).not.toHaveProperty("body");
      expect(compactObjects[0]).toHaveProperty("path");
      expect(compactObjects[0]).toHaveProperty("checksum");
      expect(compactObjects[0]).toHaveProperty("object.id", "p-1");
    });
  });

  test("round-trips CRUD through real protocol serialization with Date conversion and revision errors", async () => {
    await connected(async (client, facade) => {
      await client.listTools();
      const created = await client.callTool({
        name: "project_create",
        arguments: { object: projectJson(), body: "# Hello\n" },
      });
      expect(created.isError).not.toBe(true);
      expect(facade.createdWithDate).toBe(true);
      expect(facade.lastSignal).toBeInstanceOf(AbortSignal);
      expect(created.structuredContent).toHaveProperty(
        "object.createdAt",
        "2026-10-15T00:00:00.000Z",
      );
      expect(created.structuredContent).toHaveProperty("body", "# Hello\n");
      const { checksum } = created.structuredContent as { checksum: string };
      const read = await client.callTool({ name: "project_get", arguments: { id: "p-1" } });
      expect(read.structuredContent).toEqual(created.structuredContent);
      const listed = await client.callTool({ name: "project_list", arguments: {} });
      expect(listed.structuredContent).toHaveProperty("objects", [created.structuredContent]);
      const updated = await client.callTool({
        name: "project_update",
        arguments: {
          id: "p-1",
          object: { ...projectJson(), title: "Updated" },
          body: "Changed",
          expectedChecksum: checksum,
        },
      });
      expect(updated.isError).not.toBe(true);
      expect(updated.structuredContent).toHaveProperty("object.title", "Updated");
      const stale = await client.callTool({
        name: "project_delete",
        arguments: { id: "p-1", expectedChecksum: checksum },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
      const deleted = await client.callTool({
        name: "project_delete",
        arguments: {
          id: "p-1",
          expectedChecksum: (updated.structuredContent as { checksum: string }).checksum,
        },
      });
      expect(deleted.structuredContent).toEqual({ type: "project", id: "p-1", deleted: true });
      const missing = await client.callTool({ name: "project_get", arguments: { id: "p-1" } });
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toHaveProperty("error.code", "NOT_FOUND");
    });
  });

  test("rejects omitted nullable fields, malformed dates, extras, and null optional wrapper keys before mutations", async () => {
    await connected(async (client, facade) => {
      const { retiredAt, ...missingRetiredAt } = projectJson();
      const { relations, ...missingRelations } = projectJson();
      for (const args of [
        { object: missingRetiredAt },
        { object: missingRelations },
        { object: { ...projectJson(), createdAt: "not a date" } },
        { object: { ...projectJson(), belongsTo: "p" } },
        { object: projectJson(), body: null },
        { object: projectJson(), unexpected: true },
      ]) {
        const response = await client.callTool({ name: "project_create", arguments: args });
        expect(response.isError).toBe(true);
      }
      expect(facade.objects.size).toBe(0);
    });
  });

  test("repairs mixed nested relation fields and key casing while preserving arbitrary records and body", async () => {
    await connected(async (client, facade) => {
      const { createdAt, relations, ...base } = projectJson();
      const metadata = {
        created_at: "keep this metadata key",
        commitmentGoals: { project: "keep this nested object" },
        raw: "{project: 'keep the original string',}",
      };
      const tags = { part_of: "keep this tag", Project: "case matters here" };
      const body = "{title: 'This is Markdown, not arguments',}\n";
      const response = await client.callTool({
        name: "feature_create",
        arguments: {
          object: {
            ...base,
            id: "f-1",
            created_at: createdAt,
            relations: { project: "p-1", commitment_goals: ["g-1", "g-2"] },
            metadata,
            tags,
          },
          body,
        },
      });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toHaveProperty("object.relations", {
        project: "p-1",
        commitment: { goals: ["g-1", "g-2"] },
      });
      expect(response.structuredContent).toHaveProperty("object.metadata", metadata);
      expect(response.structuredContent).toHaveProperty("object.tags", tags);
      expect(response.structuredContent).toHaveProperty("body", body);
      expect(facade.createdWithDate).toBe(true);
      expect(response._meta).toHaveProperty("object-mcp/input-repair.repairs");
      const report = JSON.stringify(response._meta);
      expect(report).toContain("createdAt");
      expect(report).toContain("goals");
      expect(report).not.toContain("keep this");
    });
  });

  test("infers omitted object wrappers and parses stringified nested JSON before strict decoding", async () => {
    await connected(async (client) => {
      const flattened = await client.callTool({
        name: "project_create",
        arguments: { ...projectJson(), body: "# A project\n" },
      });
      expect(flattened.isError).not.toBe(true);
      expect(flattened.structuredContent).toHaveProperty("object.id", "p-1");
      expect(flattened.structuredContent).toHaveProperty("body", "# A project\n");
      expect(flattened._meta).toHaveProperty("object-mcp/input-repair.repairs");
      const stringified = await client.callTool({
        name: "project_create",
        arguments: {
          object: { ...projectJson(), id: "p-2", relations: "{partOf: null,}" },
        },
      });
      expect(stringified.isError).not.toBe(true);
      expect(stringified.structuredContent).toHaveProperty("object.relations", { partOf: null });
      expect(stringified._meta).toHaveProperty("object-mcp/input-repair.repairs");
    });
  });

  test("repairs search scalar types and scalar array wrappers without rewriting query text", async () => {
    await connected(async (client, facade) => {
      const query = "{complex_query: 'please preserve every character',}";
      const response = await client.callTool({
        name: "objects_search",
        arguments: {
          query,
          top_n: "3",
          include_body: "false",
          types: "project",
        },
      });
      expect(response.isError).not.toBe(true);
      expect(facade.lastSearch).toEqual({ query, topN: 3, includeBody: false, types: ["project"] });
      expect(response._meta).toHaveProperty("object-mcp/input-repair.repairs");
    });
  });

  test("rejects conflicting repairs, unsupported field guesses, and invalid checksum types without mutation", async () => {
    await connected(async (client, facade) => {
      for (const args of [
        { object: { ...projectJson(), ID: "another-project" } },
        { object: { ...projectJson(), part_of: "another-parent" } },
        { object: { ...projectJson(), relations: { belongsTo: "p-other" } } },
        { object: { ...projectJson(), id: 42 } },
        { object: { ...projectJson(), name: { value: "silently unwrapped" } } },
      ]) {
        const response = await client.callTool({ name: "project_create", arguments: args });
        expect(response.isError).toBe(true);
      }
      expect(facade.objects.size).toBe(0);
      const created = await client.callTool({
        name: "project_create",
        arguments: { object: projectJson() },
      });
      const checksum = (created.structuredContent as { checksum: string }).checksum;
      const { id, ...missingObjectId } = projectJson();
      for (const args of [
        { object: projectJson(), body: "changed", expectedChecksum: checksum },
        { id, object: missingObjectId, body: "changed", expectedChecksum: checksum },
        {
          id,
          object: projectJson(),
          body: "changed",
          expectedChecksum: checksum,
          expected_checksum: checksum,
        },
      ]) {
        const rejected = await client.callTool({ name: "project_update", arguments: args });
        expect(rejected.isError).toBe(true);
      }
      expect((await facade.get("project", id)).checksum).toBe(checksum);
      const wrongType = await client.callTool({
        name: "project_delete",
        arguments: { id: "p-1", expectedChecksum: 1 },
      });
      expect(wrongType.isError).toBe(true);
      expect(facade.objects.size).toBe(1);
      const stale = await client.callTool({
        name: "project_delete",
        arguments: { id: "p-1", expected_checksum: "wrong revision" },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
      expect(stale._meta).toHaveProperty("object-mcp/input-repair.repairs");
      const deleted = await client.callTool({
        name: "project_delete",
        arguments: {
          id: "p-1",
          expected_checksum: checksum,
        },
      });
      expect(deleted.isError).not.toBe(true);
      expect(facade.objects.size).toBe(0);
    });
  });

  test("keeps output validation strict when arguments were repaired", async () => {
    const facade = new MemoryFacade();
    facade.search = async () =>
      ({ mode: "hybrid", hits: [], indexGeneration: "2" }) as unknown as SearchResponse;
    await connected(async (client) => {
      const response = await client.callTool({
        name: "objects_search",
        arguments: { query: "x", top_n: "2" },
      });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response.content)).toContain("Output validation error");
    }, facade);
  });

  test("rejects empty identifiers for get, delete, and update arguments", async () => {
    await connected(async (client) => {
      const invalidCalls = [
        { name: "project_get", arguments: { id: "" } },
        { name: "project_delete", arguments: { id: "", expectedChecksum: "revision" } },
        {
          name: "project_update",
          arguments: {
            id: "",
            object: projectJson(),
            body: "",
            expectedChecksum: "revision",
          },
        },
      ];
      for (const call of invalidCalls) {
        const response = await client.callTool(call);
        expect(response.isError).toBe(true);
        const error = JSON.stringify(response.content);
        expect(error).toContain("Input validation error");
        expect(error).toContain("id");
      }
    });
  });

  test("inherits strict mode from framework configuration and supports explicit host overrides", async () => {
    const facade = new MemoryFacade();
    facade.config = defineConfig({ mcp: { inputRepair: { enabled: false } } });
    await connected(async (client) => {
      const response = await client.callTool({
        name: "objects_search",
        arguments: { query: "example", top_n: "3" },
      });
      expect(response.isError).toBe(true);
      expect(facade.lastSearch).toBeUndefined();
    }, facade);
    await connected(
      async (client) => {
        const response = await client.callTool({
          name: "objects_search",
          arguments: { query: "example", top_n: "3" },
        });
        expect(response.isError).not.toBe(true);
        expect(facade.lastSearch).toEqual({ query: "example", topN: 3 });
      },
      facade,
      (objects) => createMcpServer(objects, undefined, { inputRepair: { enabled: true } }),
    );
  });

  test("rejects malformed host repair options instead of silently enabling defaults", () => {
    for (const inputRepair of [false, null, [], { enabled: "false" }, { maxDepth: 0 }]) {
      expect(() =>
        createMcpServer(new MemoryFacade(), undefined, {
          inputRepair,
        } as unknown as McpToolOptions),
      ).toThrow("Invalid MCP input repair options");
    }
  });

  test("enforces configured input budgets before calling handlers, including strict mode", async () => {
    for (const enabled of [true, false]) {
      await connected(
        async (client, facade) => {
          const oversized = await client.callTool({
            name: "objects_search",
            arguments: { query: "x".repeat(101) },
          });
          expect(oversized.isError).toBe(true);
          expect(JSON.stringify(oversized.content)).toContain("RESOURCE_LIMIT");
          expect(facade.lastSearch).toBeUndefined();
          const normal = await client.callTool({
            name: "objects_search",
            arguments: { query: "small" },
          });
          expect(normal.isError).not.toBe(true);
        },
        new MemoryFacade(),
        (objects) =>
          createMcpServer(objects, undefined, {
            inputRepair: { enabled, maxInputBytes: 100 },
          }),
      );
    }
  });

  test("keeps repair notices with their own responses during overlapping calls", async () => {
    await connected(async (client, facade) => {
      let releaseFirst!: () => void;
      const secondEntered = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      facade.beforeCreate = async (value) => {
        if ((value as { id: string }).id === "repaired") await secondEntered;
        else releaseFirst();
      };
      const { createdAt, ...base } = projectJson();
      const [repaired, canonical] = await Promise.all([
        client.callTool({
          name: "project_create",
          arguments: { object: { ...base, id: "repaired", created_at: createdAt } },
        }),
        client.callTool({
          name: "project_create",
          arguments: { object: { ...projectJson(), id: "canonical" } },
        }),
      ]);
      expect(repaired.isError).not.toBe(true);
      expect(canonical.isError).not.toBe(true);
      expect(repaired._meta).toHaveProperty("object-mcp/input-repair.repairs");
      expect(canonical._meta?.["object-mcp/input-repair"]).toBeUndefined();
      const later = await client.callTool({ name: "objects_search", arguments: { query: "x" } });
      expect(later._meta?.["object-mcp/input-repair"]).toBeUndefined();
    });
  });

  test("forwards shared search options unchanged, emits status/resync, and leaves facade ownership with caller", async () => {
    const facade = new MemoryFacade();
    await connected(async (client) => {
      const request = {
        query: "hello",
        mode: "semantic" as const,
        types: [],
        topN: 3,
        includeBody: true,
      };
      const searched = await client.callTool({ name: "objects_search", arguments: request });
      expect(searched.structuredContent).toEqual({
        mode: "semantic",
        hits: [],
        indexGeneration: 2,
      });
      expect(facade.lastSearch).toEqual(request);
      expect(facade.lastSignal).toBeInstanceOf(AbortSignal);
      const status = await client.callTool({ name: "objects_status", arguments: {} });
      expect(status.structuredContent).toEqual({ objects: 0, embeddings: "disabled" });
      const sync = await client.callTool({ name: "objects_resync", arguments: {} });
      expect(sync.structuredContent).toHaveProperty("generation", 2);
    }, facade);
    expect(facade.closed).toBe(0);
  });

  test("propagates client request cancellation into the facade AbortSignal", async () => {
    await connected(async (client, facade) => {
      let entered!: () => void;
      let aborted!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const abortedPromise = new Promise<void>((resolve) => {
        aborted = resolve;
      });
      facade.beforeGet = async (signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        entered();
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => {
            aborted();
            reject(new DOMException("Cancelled", "AbortError"));
          };
          if (signal!.aborted) onAbort();
          else signal!.addEventListener("abort", onAbort, { once: true });
        });
      };
      const controller = new AbortController();
      const pending = client
        .callTool({ name: "project_get", arguments: { id: "wait" } }, { signal: controller.signal })
        .catch((error: unknown) => error);
      await enteredPromise;
      controller.abort();
      expect(await pending).toBeInstanceOf(Error);
      await abortedPromise;
      expect(facade.lastSignal!.aborted).toBe(true);
    });
  }, 5000);

  test("the Effect Standard Schema bridge matches strict JSON metadata for both supported dialects", async () => {
    const schema = effectMcpSchema(
      Schema.Struct({ date: Schema.Date, label: Schema.optionalKey(Schema.String) }),
    );
    for (const target of ["draft-2020-12", "draft-07"] as const) {
      const document = schema["~standard"].jsonSchema.input({ target });
      expect(document.additionalProperties).toBe(false);
      expect(document.required).toEqual(["date"]);
    }
    const decoded = await schema["~standard"].validate({ date: "2026-10-18T00:00:00Z" });
    expect("value" in decoded && decoded.value.date instanceof Date).toBe(true);
    const excess = await schema["~standard"].validate({ date: "2026-10-18Z", extra: true });
    expect(excess.issues).toBeDefined();
    expect(excess.issues?.length ?? 0).toBeGreaterThan(0);
    expect(excess.issues?.[0]?.path).toEqual(["extra"]);
    const invalid = await schema["~standard"].validate({ date: "2026-10-18Z", label: null });
    expect(invalid.issues).toBeDefined();
    expect(invalid.issues?.length ?? 0).toBeGreaterThan(0);
    expect(invalid.issues?.[0]?.path).toEqual(["label"]);
  });
});
