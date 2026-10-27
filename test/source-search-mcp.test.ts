import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createMcpServer } from "../src/lib/mcp.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import { createCoreRegistry } from "../src/registry.ts";

const roots: string[] = [];
const accesses: Awaited<ReturnType<typeof createSourceAccess>>[] = [];
const definitions = createCoreRegistry().definitions.filter(({ name }) => name === "project");

afterEach(async () => {
  const closed = await Promise.allSettled(accesses.splice(0).map((access) => access.close()));
  const removed = await Promise.allSettled(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  const failures = [...closed, ...removed].flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Source-search MCP fixture cleanup failed.");
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "source-search-mcp-"));
  roots.push(directory);
  const root = path.join(directory, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  const config = defineConfig(
    { ...defaultConfig, root, embeddings: { provider: "disabled" } },
    directory,
  );
  const access = await createSourceAccess({ config, definitions });
  accesses.push(access);
  return { access, root };
}

function sourceOutput(overrides: Record<string, unknown> = {}) {
  return {
    mode: "source",
    requestedMode: "fulltext",
    hits: [],
    indexGeneration: null,
    complete: true,
    observedCount: 0,
    issues: [],
    recovery: { state: "degraded", code: "SOURCE_ONLY" },
    ...overrides,
  };
}

describe("source-search MCP output validation", () => {
  test("accepts source partial hits and rejects missing partial fields independently", async () => {
    const { access, root } = await fixture();
    await writeFile(
      path.join(root, "projects/partial.md"),
      "---\nid: partial\n---\nsource evidence\n",
    );
    const handler = createMcpHandler(() => createMcpServer(access));
    const client = new Client(
      { name: "source-search-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(new URL("http://source-search.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    try {
      await client.connect(transport);
      const accepted = await client.callTool({
        name: "objects_search",
        arguments: { query: "evidence" },
      });
      expect(accepted.isError).not.toBe(true);
      expect(accepted.structuredContent).toMatchObject({
        mode: "source",
        indexGeneration: null,
        complete: true,
        hits: [{ partial: true, identity: { id: "partial" }, object: { id: "partial" } }],
      });

      const validPartialHit = {
        type: "project",
        id: "partial",
        name: "partial",
        title: "partial",
        path: "projects/partial.md",
        checksum: "checksum",
        score: 0.5,
        fulltextRank: null,
        fulltextExcerpt: null,
        semanticDistance: null,
        matchedChunk: null,
        partial: true,
        object: { id: "partial" },
        identity: { source: "frontmatter", id: "partial", type: "project" },
        issues: [{ code: "VALIDATION", message: "Partial source object." }],
      };
      const withoutObject = { ...validPartialHit };
      const withoutIdentity = { ...validPartialHit };
      const withoutIssues = { ...validPartialHit };
      expect(Reflect.deleteProperty(withoutObject, "object")).toBe(true);
      expect(Reflect.deleteProperty(withoutIdentity, "identity")).toBe(true);
      expect(Reflect.deleteProperty(withoutIssues, "issues")).toBe(true);
      const invalidOutputs = [
        sourceOutput({ indexGeneration: 1 }),
        sourceOutput({ complete: undefined }),
        sourceOutput({ hits: [withoutObject] }),
        sourceOutput({ hits: [withoutIdentity] }),
        sourceOutput({ hits: [withoutIssues] }),
      ];
      Object.defineProperty(access, "search", {
        configurable: true,
        value: async () => invalidOutputs.shift(),
      });
      const invalidOutputCount = invalidOutputs.length;
      for (let index = 0; index < invalidOutputCount; index += 1) {
        const rejected = await client.callTool({
          name: "objects_search",
          arguments: { query: "evidence" },
        });
        expect(rejected.isError).toBe(true);
        expect(JSON.stringify(rejected.content)).toContain("Output validation error");
      }
    } finally {
      try {
        await client.close();
      } finally {
        await handler.close();
      }
    }
  });
});
