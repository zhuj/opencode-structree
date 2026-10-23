import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFramework, type ObjectFramework } from "../src/framework.ts";
import { FileStore, objectKey } from "../src/lib/filesystem.ts";
import { createMcpServer } from "../src/lib/mcp.ts";
import type { EmbeddingProvider } from "../src/lib/types.ts";
import { MarkdownCodec } from "../src/lib/vault/codec.ts";
import { Vault } from "../src/lib/vault/vault.ts";
import { createCoreRegistry } from "../src/registry.ts";

const open: ObjectFramework[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((framework) => framework.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const project = (id = "valid") => ({
  id,
  name: id,
  title: "Validated project",
  description: "A project",
  createdAt: new Date("2026-10-15T12:00:00Z"),
  updatedAt: new Date("2026-10-15T12:00:00Z"),
  retiredAt: null,
  tags: {},
  metadata: {},
  relations: { partOf: null },
});
class SyntheticProvider implements EmbeddingProvider {
  readonly dimensions = 4;
  readonly fingerprint = "tolerant-test-v1";
  readonly documents: string[] = [];
  async embed(texts: readonly string[], purpose: "query" | "document") {
    if (purpose === "document") this.documents.push(...texts);
    return texts.map(() => new Float32Array([1, 0, 0, 0]));
  }
  async close() {}
}
async function fixture(driver: "bun" | "better-sqlite3" = "bun", provider?: SyntheticProvider) {
  const directory = await mkdtemp(path.join(tmpdir(), "tolerant-integration-"));
  directories.push(directory);
  const framework = await createFramework({
    baseDirectory: directory,
    config: {
      root: "objects",
      sqlite: { path: "cache/index.sqlite", driver },
      embeddings: { provider: "disabled" },
      sync: { watch: false, rescanIntervalMs: 0 },
    },
    ...(provider ? { embeddingProvider: provider } : {}),
  });
  open.push(framework);
  await framework.resync();
  return { framework, root: path.join(directory, "objects") };
}

describe("tolerant source and index integration", () => {
  test("Vault/FileStore/framework read every recoverable header form without fabricating required fields", async () => {
    const { framework, root } = await fixture();
    const registry = createCoreRegistry();
    const store = new FileStore(registry, framework.config);
    await store.initialize();
    try {
      const vault = new Vault(
        store.files,
        new MarkdownCodec({
          decode: (value) => registry.decode("project", value),
          encode: (header) => registry.encode("project", header),
        }),
      );
      const documents = [
        "No frontmatter nectar",
        "---\n---\nEmpty header nectar",
        "---\nscalar\n---\nScalar nectar",
        "---\n- a\n---\nSequence nectar",
        "---\ntitle: Incomplete\n---\nIncomplete nectar",
        "---\nid: [broken\n---\nMalformed nectar",
        "---\nid: unfinished\nUnterminated nectar",
        "---\nid: explicit-alias\ntitle: Safe\nmetadata: *missing\n---\nAlias nectar",
      ];
      for (const [index, raw] of documents.entries()) {
        const relative = `projects/form-${index}.md`;
        await writeFile(path.join(root, relative), raw);
        const read = await vault.read(relative);
        expect(read).toMatchObject({ partial: true, raw });
        if (index === 6) expect(read.body).toBe(raw);
        const id = index === 7 ? "explicit-alias" : `form-${index}`;
        const object = await framework.get("project", id);
        expect(object.partial).toBe(true);
        expect(object.object).not.toHaveProperty("createdAt");
        expect(object.object).not.toHaveProperty("relations");
        expect(object.object).not.toHaveProperty("inferred");
        expect(await readFile(path.join(root, relative), "utf8")).toBe(raw);
      }
      await framework.resync();
      expect((await framework.list("project")).total).toBe(documents.length);
      expect((await framework.search({ query: "nectar", mode: "fulltext" })).hits).toHaveLength(
        documents.length,
      );
      await expect(vault.read("../escape.md")).rejects.toMatchObject({ code: "PATH" });
      const controller = new AbortController();
      controller.abort();
      await expect(store.scan(undefined, controller.signal)).rejects.toThrow();
    } finally {
      await store.close();
    }
  });
  for (const driver of ["bun", "better-sqlite3"] as const) {
    test(`${driver}: reads, lists and indexes partial text, with explicit and inferred identity`, async () => {
      const provider = new SyntheticProvider();
      const { framework, root } = await fixture(driver, provider);
      const plain = "# Orchard\nRecovered nectar content\n";
      const explicit =
        "---\nid: explicit\ntitle: Recovered title\nbroken: [\n---\nNectar malformed\n";
      await writeFile(path.join(root, "projects", "Plain.md"), plain);
      await writeFile(path.join(root, "projects", "wrong-name.md"), explicit);
      await writeFile(path.join(root, "features", "Plain.md"), plain);
      const store = new FileStore(createCoreRegistry(), framework.config);
      await store.initialize();
      try {
        const scan = await store.scan();
        expect(scan.documents.map((d) => d.key).sort()).toEqual(
          [
            objectKey("feature", "plain"),
            objectKey("project", "explicit"),
            objectKey("project", "plain"),
          ].sort(),
        );
        expect(store.parse("project", "projects/Plain.md", plain)).toMatchObject({
          partial: true,
          key: "project:plain",
          body: plain,
        });
      } finally {
        await store.close();
      }
      const read = await framework.get("project", "PLAIN");
      expect(read).toMatchObject({
        partial: true,
        object: { id: "plain" },
        identity: { source: "filename", id: "plain", type: "project" },
        body: plain,
        raw: plain,
      });
      expect(read.object).not.toHaveProperty("createdAt");
      const recovered = await framework.get("project", "explicit");
      expect(recovered).toMatchObject({
        partial: true,
        object: { id: "explicit", title: "Recovered title" },
        identity: { source: "frontmatter" },
        body: "Nectar malformed\n",
        raw: explicit,
      });
      expect((await framework.list("project")).total).toBe(2);
      await framework.resync();
      expect(
        (await framework.search({ query: "nectar", mode: "fulltext", includeBody: true })).hits,
      ).toHaveLength(3);
      const hits = (await framework.search({ query: "orchard", mode: "semantic" })).hits;
      expect(hits).toHaveLength(3);
      expect(hits.every((hit) => hit.partial === true && hit.issues && hit.identity)).toBe(true);
      expect(provider.documents.some((text) => text.includes("Nectar malformed"))).toBe(true);
      expect(await readFile(path.join(root, "projects", "wrong-name.md"), "utf8")).toBe(explicit);
      expect((await readdir(path.join(root, "projects"))).sort()).toEqual([
        "Plain.md",
        "wrong-name.md",
      ]);
    });
  }

  test("valid-invalid-valid transitions refresh text and vectors without stale resurrection", async () => {
    const { framework, root } = await fixture("bun", new SyntheticProvider());
    const valid = await framework.create("project", project(), "Oldtext orchard");
    await framework.resync();
    const raw = await readFile(path.join(root, valid.path), "utf8");
    await writeFile(path.join(root, valid.path), "Newtext nectar");
    await framework.resync();
    expect((await framework.search({ query: "oldtext", mode: "fulltext" })).hits).toEqual([]);
    expect((await framework.search({ query: "newtext", mode: "fulltext" })).hits[0]).toMatchObject({
      id: "valid",
      partial: true,
    });
    expect((await framework.search({ query: "nectar", mode: "semantic" })).hits[0]).toMatchObject({
      partial: true,
      matchedChunk: { text: "Newtext nectar" },
    });
    await writeFile(path.join(root, valid.path), raw);
    await framework.resync();
    expect((await framework.search({ query: "newtext", mode: "fulltext" })).hits).toEqual([]);
    expect(
      (await framework.search({ query: "oldtext", mode: "fulltext" })).hits[0],
    ).not.toHaveProperty("partial");
    expect((await framework.get("project", "valid")).object.createdAt).toEqual(project().createdAt);
    const semantic = (await framework.search({ query: "orchard", mode: "semantic" })).hits[0];
    expect(semantic).not.toHaveProperty("partial");
    expect(semantic?.matchedChunk?.text).toContain("Oldtext orchard");
  });

  test("partial relations use only descriptor-shaped ids and do not hide unrelated reads", async () => {
    const { framework, root } = await fixture();
    await framework.create("project", project("parent"));
    await writeFile(
      path.join(root, "projects", "child.md"),
      "---\nid: child\nretiredAt: false\nrelations:\n  partOf: parent\n---\nChild",
    );
    await writeFile(
      path.join(root, "projects", "invalid.md"),
      "---\nrelations:\n  partOf: [parent, 123]\n---\nInvalid relation",
    );
    const graph = await framework.relations({ type: "project", id: "parent" });
    expect(graph).toMatchObject({
      complete: false,
      edges: [{ field: "relations.partOf", from: { id: "child" }, to: { id: "parent" } }],
    });
    expect(graph.issues?.length).toBeGreaterThan(0);
    expect(
      (await framework.relations({ type: "project", id: "parent", includeRetired: false })).edges,
    ).toHaveLength(1);
    await expect(framework.relations({ type: "project", id: "absent" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("valid/partial duplicates are ambiguous; inferred mutations refuse and writes remain strict", async () => {
    const { framework, root } = await fixture();
    const valid = await framework.create("project", project("collision"));
    await writeFile(path.join(root, "projects", "copy.md"), "---\nid: collision\n---\nDuplicate");
    await expect(framework.get("project", "collision")).rejects.toMatchObject({
      code: "DUPLICATE_ID",
    });
    await expect(framework.delete("project", "collision", valid.checksum)).rejects.toMatchObject({
      code: "DUPLICATE_ID",
    });
    await writeFile(path.join(root, "projects", "inferred.md"), "Readable");
    const inferred = await framework.get("project", "inferred");
    await expect(framework.delete("project", "inferred", inferred.checksum)).rejects.toMatchObject({
      code: "SOURCE_CONFLICT",
    });
    await expect(
      framework.update(
        "project",
        "inferred",
        project("inferred"),
        "replacement",
        inferred.checksum,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_CONFLICT" });
    await expect(framework.create("feature", { id: "incomplete" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await framework.resync();
    expect((await framework.search({ query: "duplicate", mode: "fulltext" })).hits).toEqual([]);
    expect(await readFile(path.join(root, "projects", "inferred.md"), "utf8")).toBe("Readable");
  });

  test("MCP get/list/search validate partial output, reduced listings omit raw and body", async () => {
    const { framework, root } = await fixture();
    const raw = "---\ntitle: Recoverable\n---\nNectar body";
    await writeFile(path.join(root, "projects", "partial.md"), raw);
    await framework.resync();
    const handler = createMcpHandler(() => createMcpServer(framework));
    const client = new Client(
      { name: "tolerant-integration", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://tolerant.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    try {
      const get = await client.callTool({ name: "project_get", arguments: { id: "partial" } });
      expect(get.isError).not.toBe(true);
      expect(get.structuredContent).toMatchObject({
        partial: true,
        raw,
        object: { title: "Recoverable" },
      });
      const list = await client.callTool({
        name: "project_list",
        arguments: { includeBody: false },
      });
      expect(list.isError).not.toBe(true);
      expect(list.structuredContent).toMatchObject({
        total: 1,
        objects: [{ partial: true, object: { id: "partial" } }],
      });
      expect(list.structuredContent).not.toHaveProperty("objects.0.raw");
      expect(list.structuredContent).not.toHaveProperty("objects.0.body");
      const search = await client.callTool({
        name: "objects_search",
        arguments: { query: "nectar", mode: "fulltext" },
      });
      expect(search.isError).not.toBe(true);
      expect(search.structuredContent).toMatchObject({
        hits: [{ partial: true, id: "partial", object: { title: "Recoverable" } }],
      });
      const tools = (await client.listTools()).tools;
      expect(tools.find((tool) => tool.name === "project_list")?.description).toContain("partial");
      expect(tools.find((tool) => tool.name === "objects_search")?.description).not.toContain(
        "enumerate valid objects",
      );
    } finally {
      await client.close();
      await handler.close();
    }
  });
});
