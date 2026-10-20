import { describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { defineConfig } from "../src/lib/config.ts";
import { FrameworkError } from "../src/lib/errors";
import {
  createMcpServer,
  effectMcpSchema,
  type McpToolOptions,
  registerObjectTools,
} from "../src/lib/mcp";
import type {
  FrameworkConfig,
  ObjectFacade,
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
  config?: Pick<FrameworkConfig, "mcp">;
  readonly objects = new Map<string, StoredObject>();
  readonly registry = createCoreRegistry();
  lastSignal: AbortSignal | undefined;
  lastSearch: SearchRequest | undefined;
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
    const key = JSON.stringify([type, object.id]);
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
    const stored = this.objects.get(JSON.stringify([type, id]));
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
    this.objects.set(JSON.stringify([type, id]), stored);
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
    this.objects.delete(JSON.stringify([type, id]));
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
  test("attaches the generated tools to an existing host server without replacing its tools", async () => {
    const facade = new MemoryFacade();
    await connected(
      async (client) => {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(65);
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

  test("advertises all 64 tools with schema-derived required fields and optional wrapper keys", async () => {
    await connected(async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(64);
      for (const definition of coreDefinitions) {
        for (const operation of ["create", "get", "update", "delete", "list"]) {
          expect(tools.some((tool) => tool.name === `${definition.name}_${operation}`)).toBe(true);
        }
      }
      const create = tools.find((tool) => tool.name === "project_create")!;
      const schema = create.inputSchema;
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
