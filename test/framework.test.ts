import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { createFramework, type FrameworkEvent, type ObjectFramework } from "../src/framework.ts";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import { FrameworkError } from "../src/lib/errors.ts";
import type { FileStore } from "../src/lib/filesystem.ts";
import { createMcpServer } from "../src/lib/mcp.ts";
import {
  type EmbeddingProvider,
  type ObjectDefinition,
  STATUS_ISSUE_LIMIT,
  type StoredObject,
} from "../src/lib/types.ts";
import { coreDefinitions, ObjectRegistry } from "../src/registry.ts";

const tempDirs: string[] = [];
const open: ObjectFramework[] = [];
afterEach(async () => {
  await Promise.allSettled(open.splice(0).map((framework) => framework.close()));
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const project = (id = "p-1", title = "Local architecture") => ({
  id,
  name: id,
  title,
  description: "Architecture project",
  createdAt: new Date("2026-10-15T12:00:00.000Z"),
  updatedAt: new Date("2026-10-15T12:00:00.000Z"),
  retiredAt: null,
  tags: { priority: "high" },
  metadata: {},
  relations: { partOf: null },
});

const adr = (id = "a-1", title = "Recorded decision") => ({
  id,
  name: id,
  title,
  description: "Architecture decision record",
  createdAt: new Date("2026-10-15T12:00:00.000Z"),
  updatedAt: new Date("2026-10-15T12:00:00.000Z"),
  retiredAt: null,
  tags: {},
  metadata: {},
  relations: { commitment: { scenarios: [] }, partOf: null, dependsOn: [] },
});

/** A JSON-shaped object whose reading is decoded from a string, like a frontmatter value. */
const measure = (id = "m-1", reading = "1") => ({
  id,
  name: id,
  title: "Measured value",
  description: "A measurement",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
  retiredAt: null,
  tags: {},
  metadata: {},
  reading,
});

class TestEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 4;
  documentCalls = 0;
  closed = false;
  prepareCalls = 0;
  prepareFailure: Error | undefined;
  beforeDocument: ((texts: readonly string[], signal?: AbortSignal) => Promise<void>) | undefined;
  beforeQuery: ((texts: readonly string[], signal?: AbortSignal) => Promise<void>) | undefined;
  constructor(readonly fingerprint = "integration-test-v1") {}
  async prepare(): Promise<void> {
    this.prepareCalls++;
    if (this.prepareFailure) throw this.prepareFailure;
  }
  async embed(
    texts: readonly string[],
    purpose: "document" | "query",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    signal?.throwIfAborted();
    if (purpose === "document") {
      this.documentCalls++;
      await this.beforeDocument?.(texts, signal);
    } else {
      await this.beforeQuery?.(texts, signal);
    }
    signal?.throwIfAborted();
    return texts.map((text) => {
      const lower = text.toLowerCase();
      const values = [
        /car|automobile/.test(lower) ? 5 : 0,
        /database|sqlite/.test(lower) ? 5 : 0,
        /project|architecture/.test(lower) ? 1 : 0,
        0.1,
      ];
      const norm = Math.hypot(...values);
      return Float32Array.from(values.map((value) => value / norm));
    });
  }
  async close() {
    this.closed = true;
  }
}

async function fixture(
  options: {
    watch?: boolean;
    provider?: TestEmbeddingProvider;
    directory?: string;
    definitions?: readonly ObjectDefinition[];
  } = {},
) {
  const directory =
    options.directory ?? (await mkdtemp(path.join(os.tmpdir(), "object-mcp-framework-")));
  if (!options.directory) tempDirs.push(directory);
  const framework = await createFramework({
    ...(options.definitions ? { definitions: options.definitions } : {}),
    baseDirectory: directory,
    config: {
      root: "objects",
      sqlite: { path: "cache/index.sqlite" },
      embeddings: { provider: "disabled" },
      chunking: { size: 200 },
      sync: { watch: options.watch ?? false, debounceMs: 20, rescanIntervalMs: 0 },
    },
    ...(options.provider ? { embeddingProvider: options.provider } : {}),
  });
  open.push(framework);
  return { framework, directory, root: path.join(directory, "objects") };
}

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for filesystem reconciliation.");
    await delay(20);
  }
}

describe("filesystem-authoritative framework", () => {
  test("custom identifier schemas cannot bypass the shared filename domain", async () => {
    const { framework, root } = await fixture({
      definitions: [
        {
          name: "custom",
          directory: "customs",
          description: "Custom identifier schema",
          schema: Schema.Struct({ ...BaseObjectSchema.fields, id: Schema.String }),
        },
      ],
    });
    for (const id of ["../outside", "con", ".hidden", "a".repeat(201)])
      await expect(framework.create("custom", measure(id))).rejects.toMatchObject({
        code: "VALIDATION",
      });
    expect(await readdir(path.join(root, "customs"))).toEqual([]);
    const { relations: _relations, ...valid } = project("GoodId");
    const created = await framework.create("custom", valid);
    expect(created.object.id).toBe("goodid");
  });

  test("reconciliation reports a filesystem rename failure and continues", async () => {
    const { framework, root } = await fixture();
    const first = await framework.create("project", project("first"));
    const second = await framework.create("project", project("second"));
    await framework.resync();
    await rename(path.join(root, first.path), path.join(root, "projects/a.md"));
    await rename(path.join(root, second.path), path.join(root, "projects/b.md"));
    const resources = framework as unknown as { readonly store: FileStore };
    const renameFile = resources.store.files.renameBasename.bind(resources.store.files);
    const renameSpy = spyOn(resources.store.files, "renameBasename").mockImplementation(
      (...args) => {
        if (args[0] === "projects/a.md") return Promise.reject(new Error("Rename denied"));
        return renameFile(...args);
      },
    );
    try {
      const report = await framework.resync();
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          path: "projects/a.md",
          code: "RENAME",
          message: "Rename denied",
        }),
      );
      expect((await readdir(path.join(root, "projects"))).sort()).toEqual(["a.md", "second.md"]);
      expect(framework.status().objects).toBe(1);
      expect((await framework.get("project", "second")).path).toBe(second.path);
    } finally {
      renameSpy.mockRestore();
    }
  });

  test("CRUD normalizes ids and nested relation identifiers before identity lookup", async () => {
    const { framework } = await fixture();
    const input = {
      ...adr("MyThing"),
      relations: {
        commitment: { scenarios: ["ScEnArIo"] },
        partOf: "PaReNt",
        dependsOn: ["OtHeR"],
      },
    };
    const created = await framework.create("adr", input);
    expect(created.object.id).toBe("mything");
    expect(created.path).toBe("adrs/mything.md");
    expect(created.object).toMatchObject({
      relations: {
        commitment: { scenarios: ["scenario"] },
        partOf: "parent",
        dependsOn: ["other"],
      },
    });
    expect(input.id).toBe("MyThing");
    expect((await framework.get("adr", "MyThing")).object.id).toBe("mything");
    await expect(framework.create("adr", adr("MYTHING"))).rejects.toMatchObject({
      code: "ALREADY_EXISTS",
    });
    const updated = await framework.update("adr", "MYTHING", input, "changed", created.checksum);
    expect(updated.object.id).toBe("mything");
    expect(await framework.delete("adr", "MyThing", updated.checksum)).toEqual({
      type: "adr",
      id: "mything",
      deleted: true,
    });
  });

  test("reconciliation corrects only the basename and follows it in the index", async () => {
    const { framework, root } = await fixture();
    const created = await framework.create("project", project(), "rename-evidence");
    await framework.resync();
    await mkdir(path.join(root, "projects/nested"));
    await rename(path.join(root, created.path), path.join(root, "projects/nested/other.md"));
    expect((await framework.resync()).issues).toEqual([]);
    expect((await framework.get("project", "p-1")).path).toBe("projects/nested/p-1.md");
    expect(
      (await framework.search({ query: "rename-evidence", mode: "fulltext" })).hits[0]?.path,
    ).toBe("projects/nested/p-1.md");
    expect(await readdir(path.join(root, "projects/nested"))).toEqual(["p-1.md"]);
  });

  test("reconciliation keeps equivalent filenames indexed at their actual discovered path", async () => {
    const { framework, root } = await fixture();
    const created = await framework.create(
      "project",
      project("mything"),
      "equivalent-name-evidence",
    );
    await framework.resync();
    const actual = "projects/MyThing.md";
    await rename(path.join(root, created.path), path.join(root, actual));
    const resources = framework as unknown as { readonly store: FileStore };
    const renameFile = resources.store.files.renameBasename.bind(resources.store.files);
    const renameSpy = spyOn(resources.store.files, "renameBasename").mockImplementation(
      async (...args) => {
        // Simulate a folded target after discovery, without adding a duplicate scan entry.
        if ((await resources.store.files.hash(created.path)) === null)
          await link(path.join(root, actual), path.join(root, created.path));
        return renameFile(...args);
      },
    );
    try {
      const report = await framework.resync();
      expect(report.issues).toEqual([]);
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(framework.status().objects).toBe(1);
      expect(
        (await framework.search({ query: "equivalent-name-evidence", mode: "fulltext" })).hits[0]
          ?.path,
      ).toBe(actual);
      expect(await readFile(path.join(root, actual), "utf8")).toContain("id: mything");
    } finally {
      renameSpy.mockRestore();
    }
  });

  test("reconciliation excludes filename conflicts without overwriting either file", async () => {
    const { framework, root } = await fixture();
    const created = await framework.create("project", project());
    await framework.resync();
    const original = await readFile(path.join(root, created.path), "utf8");
    await rename(path.join(root, created.path), path.join(root, "projects/other.md"));
    await writeFile(path.join(root, created.path), "not a valid document");
    const report = await framework.resync();
    expect(report.issues).toContainEqual(
      expect.objectContaining({ path: "projects/other.md", code: "DUPLICATE_ID" }),
    );
    expect(framework.status().objects).toBe(0);
    expect(await readFile(path.join(root, "projects/other.md"), "utf8")).toBe(original);
    expect(await readFile(path.join(root, created.path), "utf8")).toBe("not a valid document");
  });

  test("reconciliation indexes invalid frontmatter ids by filename without renaming the source", async () => {
    const { framework, root } = await fixture();
    const created = await framework.create("project", project());
    await framework.resync();
    const raw = (await readFile(path.join(root, created.path), "utf8")).replace(
      "id: p-1",
      "id: ../outside",
    );
    await writeFile(path.join(root, created.path), raw);
    const report = await framework.resync();
    expect(report.issues).toContainEqual(
      expect.objectContaining({ path: created.path, code: "VALIDATION" }),
    );
    expect(framework.status().objects).toBe(1);
    expect(await framework.get("project", "p-1")).toMatchObject({
      partial: true,
      identity: { source: "filename" },
      object: { id: "p-1" },
    });
    expect(await readFile(path.join(root, created.path), "utf8")).toBe(raw);
    expect(await readdir(path.join(root, "projects"))).toEqual(["p-1.md"]);
  });

  test("reconciliation indexes a hand-written mixed-case id as partial without rewriting it", async () => {
    const { framework, root } = await fixture();
    const created = await framework.create("project", project("mything"));
    await framework.resync();
    const raw = (await readFile(path.join(root, created.path), "utf8")).replace(
      "id: mything",
      "id: MyThing",
    );
    await writeFile(path.join(root, created.path), raw);
    const report = await framework.resync();
    expect(report.issues).toContainEqual(
      expect.objectContaining({ path: created.path, code: "VALIDATION" }),
    );
    expect(framework.status().objects).toBe(1);
    expect(await framework.get("project", "mything")).toMatchObject({
      partial: true,
      identity: { source: "frontmatter" },
      object: { id: "mything" },
    });
    expect(await readFile(path.join(root, created.path), "utf8")).toBe(raw);
    expect(await readdir(path.join(root, "projects"))).toEqual(["mything.md"]);
  });

  test("MCP CRUD accepts mixed-case ids and stores lowercase ids and filenames, including capital dotted I", async () => {
    const { framework, root } = await fixture();
    const handler = createMcpHandler(() => createMcpServer(framework));
    const client = new Client(
      { name: "identifier-integration", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://framework.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    try {
      const registry = new ObjectRegistry(coreDefinitions);
      for (const id of ["MyThing", "İ"]) {
        const normalized = id.toLowerCase();
        const object = registry.encode("project", {
          ...project(id),
          relations: { partOf: "PaReNt" },
        });
        const created = await client.callTool({ name: "project_create", arguments: { object } });
        expect(created.isError).not.toBe(true);
        expect(created.structuredContent).toMatchObject({
          object: { id: normalized, relations: { partOf: "parent" } },
          path: `projects/${normalized}.md`,
        });
        expect(await readFile(path.join(root, `projects/${normalized}.md`), "utf8")).toContain(
          `id: ${normalized}`,
        );
        const fetched = await client.callTool({ name: "project_get", arguments: { id } });
        expect(fetched.isError).not.toBe(true);
        expect(fetched.structuredContent).toMatchObject({ object: { id: normalized } });
        const duplicate = await client.callTool({ name: "project_create", arguments: { object } });
        expect(duplicate.isError).toBe(true);
        expect(duplicate.structuredContent).toHaveProperty("error.code", "ALREADY_EXISTS");
        const updated = await client.callTool({
          name: "project_update",
          arguments: {
            id,
            object,
            body: "Updated",
            expectedChecksum: (created.structuredContent as { checksum: string }).checksum,
          },
        });
        expect(updated.isError).not.toBe(true);
        expect(updated.structuredContent).toMatchObject({
          object: { id: normalized },
          path: `projects/${normalized}.md`,
        });
        const deleted = await client.callTool({
          name: "project_delete",
          arguments: {
            id,
            expectedChecksum: (updated.structuredContent as { checksum: string }).checksum,
          },
        });
        expect(deleted.isError).not.toBe(true);
        expect(deleted.structuredContent).toMatchObject({ id: normalized, deleted: true });
      }
    } finally {
      await client.close();
      await handler.close();
    }
  });

  test("search carries lexical evidence independently of body and preserves semantic-only chunks", async () => {
    const { framework } = await fixture({ provider: new TestEmbeddingProvider() });
    await framework.create("project", project(), "A car design with orchard evidence");
    await framework.resync();
    const lexical = (await framework.search({ query: "orchard", mode: "fulltext" })).hits[0]!;
    expect(lexical.fulltextExcerpt).toContain("orchard");
    expect(lexical.matchedChunk).toBeNull();
    expect(lexical).not.toHaveProperty("body");
    expect(
      (await framework.search({ query: "orchard", mode: "fulltext", includeBody: false })).hits[0]!
        .fulltextExcerpt,
    ).toBe(lexical.fulltextExcerpt);
    expect(
      (await framework.search({ query: "orchard", mode: "fulltext", includeBody: true })).hits[0]!
        .body,
    ).toBe("A car design with orchard evidence");
    const semantic = (await framework.search({ query: "automobile", mode: "semantic" })).hits[0]!;
    const hybrid = (await framework.search({ query: "automobile", mode: "hybrid" })).hits[0]!;
    expect(semantic.fulltextExcerpt).toBeNull();
    expect(hybrid.fulltextExcerpt).toBeNull();
    expect(hybrid.fulltextRank).toBeNull();
    expect(hybrid.matchedChunk).toEqual(semantic.matchedChunk);
    expect(hybrid.matchedChunk).not.toBeNull();
    expect(hybrid).not.toHaveProperty("body");
  });

  test("checksum rejection discards the entire excerpt-bearing hit without refill or extra reads", async () => {
    for (const missing of [false, true]) {
      const { framework, root } = await fixture();
      const strong = await framework.create(
        "project",
        project("strong", "orchard orchard"),
        "orchard orchard",
      );
      await framework.create("project", project("weak", "ordinary"), "orchard");
      const resources = framework as unknown as { readonly store: FileStore };
      const reads = spyOn(resources.store, "readRaw");
      const reconcile = spyOn(framework, "requestResync").mockImplementation(() => {});
      try {
        const original = await framework.search({ query: "orchard", mode: "fulltext", topN: 1 });
        expect(original.hits[0]!.id).toBe("strong");
        expect(original.hits[0]!.fulltextExcerpt).toContain("orchard");
        expect(reads).toHaveBeenCalledTimes(1);
        const filename = path.join(root, strong.path);
        if (missing) await rm(filename);
        else await writeFile(filename, "changed source");
        reads.mockClear();
        const rejected = await framework.search({ query: "orchard", mode: "fulltext", topN: 1 });
        expect(rejected.hits).toEqual([]);
        expect(rejected.indexGeneration).toBe(original.indexGeneration);
        expect(reads).toHaveBeenCalledTimes(1);
        expect(reconcile).toHaveBeenCalledTimes(1);
      } finally {
        reads.mockRestore();
        reconcile.mockRestore();
      }
    }
  });

  test("CRUD persists exact schemas and separate body; invalid IDs cannot become paths", async () => {
    const { framework, root } = await fixture();
    await expect(
      framework.create("project", project("../../outside:project")),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const input = project();
    const created = await framework.create(
      "project",
      input,
      "# Design\n\nFilesystem is authoritative.\n",
    );
    expect(created.path).toBe("projects/p-1.md");
    const raw = await readFile(path.join(root, created.path), "utf8");
    expect(raw).toContain("createdAt: 2026-10-15T12:00:00.000Z");
    expect(raw).toContain("---\n# Design");
    expect((await framework.get("project", input.id)).object.createdAt).toBeInstanceOf(Date);
    expect((await framework.list("project")).total).toBe(1);
    const replacement = {
      ...input,
      title: "Updated",
      updatedAt: new Date("2026-10-18T12:00:00.000Z"),
    };
    const updated = await framework.update(
      "project",
      input.id,
      replacement,
      "Updated body",
      created.checksum,
    );
    expect(updated.checksum).not.toBe(created.checksum);
    await expect(
      framework.update("project", input.id, replacement, "Old writer", created.checksum),
    ).rejects.toMatchObject({ code: "CHECKSUM_CONFLICT" });
    await expect(
      framework.update(
        "project",
        input.id,
        { ...replacement, createdAt: new Date() },
        "",
        updated.checksum,
      ),
    ).rejects.toMatchObject({ code: "IMMUTABLE_CREATED_AT" });
    expect(await framework.delete("project", input.id, updated.checksum)).toEqual({
      type: "project",
      id: input.id,
      deleted: true,
    });
    await expect(framework.get("project", input.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(framework.status().objects).toBe(0);
  });

  test("two concurrent writers cannot both consume the same checksum", async () => {
    const { framework } = await fixture();
    const created = await framework.create("project", project());
    const results = await Promise.allSettled([
      framework.update("project", "p-1", project("p-1", "A"), "A", created.checksum),
      framework.update("project", "p-1", project("p-1", "B"), "B", created.checksum),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.code).toBe("CHECKSUM_CONFLICT");
    expect((await framework.list("project")).total).toBe(1);
  });

  test("external edits, rename, duplicate IDs, and malformed YAML reconcile without overwriting sources", async () => {
    const provider = new TestEmbeddingProvider();
    const { framework, root } = await fixture({ provider });
    const created = await framework.create("project", project(), "A car design");
    await framework.resync();
    expect((await framework.search({ query: "automobile", mode: "semantic" })).hits).toHaveLength(
      1,
    );
    const count = provider.documentCalls;
    const oldPath = path.join(root, created.path);
    const newPath = path.join(path.dirname(oldPath), "human-readable.md");
    await rename(oldPath, newPath);
    await framework.resync();
    expect(provider.documentCalls).toBe(count);
    expect((await framework.get("project", "p-1")).path).toBe(created.path);
    expect((await framework.search({ query: "automobile", mode: "semantic" })).hits[0]?.path).toBe(
      created.path,
    );
    await expect(readFile(newPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const original = await readFile(oldPath, "utf8");
    const duplicate = path.join(path.dirname(oldPath), "duplicate.md");
    await writeFile(duplicate, original);
    const duplicateReport = await framework.resync();
    expect(duplicateReport.issues.filter((issue) => issue.code === "DUPLICATE_ID")).toHaveLength(2);
    expect(framework.status().objects).toBe(0);
    await expect(framework.get("project", "p-1")).rejects.toMatchObject({ code: "DUPLICATE_ID" });
    await rm(duplicate);
    await writeFile(oldPath, "---\nid: [broken\n---\nPreserve this text");
    expect((await framework.resync()).issues[0]?.code).toBe("YAML");
    expect(await readFile(oldPath, "utf8")).toContain("Preserve this text");
    await writeFile(oldPath, original.replace("A car design", "A SQLite database design"));
    await framework.resync();
    expect((await framework.search({ query: "SQLite", mode: "fulltext" })).hits).toHaveLength(1);
    expect((await framework.search({ query: "car", mode: "fulltext" })).hits).toHaveLength(0);
    await rm(oldPath);
    expect((await framework.resync()).deleted).toBe(1);
    expect(framework.status().embeddingRows).toBe(0);
  });

  test("watcher detects independent file edits and deletion", async () => {
    const { framework, root } = await fixture({ watch: true });
    const created = await framework.create("project", project(), "Original body");
    await framework.resync();
    const filename = path.join(root, created.path);
    const raw = await readFile(filename, "utf8");
    await writeFile(filename, raw.replace("Original body", "watcher-specific-term"));
    await eventually(
      async () =>
        (await framework.search({ query: "watcher-specific-term", mode: "fulltext" })).hits
          .length === 1,
    );
    await rm(filename);
    await eventually(() => framework.status().objects === 0);
  });

  test("restart reuses unchanged vectors; provider fingerprint changes rebuild them", async () => {
    const first = new TestEmbeddingProvider("model-v1");
    const { framework, directory } = await fixture({ provider: first });
    await framework.create("project", project(), "SQLite cache");
    await framework.resync();
    expect(first.documentCalls).toBeGreaterThan(0);
    await framework.close();
    const same = new TestEmbeddingProvider("model-v1");
    const second = await fixture({ directory, provider: same });
    expect(same.documentCalls).toBe(0);
    expect(second.framework.status().objects).toBe(1);
    await second.framework.close();
    const changed = new TestEmbeddingProvider("model-v2");
    const third = await fixture({ directory, provider: changed });
    expect(changed.documentCalls).toBeGreaterThan(0);
    expect(
      (await third.framework.search({ query: "database", mode: "semantic" })).hits,
    ).toHaveLength(1);
  });

  test("file changes during embedding reject stale work and index the new revision", async () => {
    const provider = new TestEmbeddingProvider();
    const { framework } = await fixture({ provider });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let blocked = false;
    provider.beforeDocument = async (texts) => {
      if (!blocked && texts.some((text) => text.includes("old-revision-text"))) {
        blocked = true;
        entered();
        await gate;
      }
    };
    const created = await framework.create("project", project(), "old-revision-text car");
    const syncing = framework.resync();
    await started;
    const updated = await framework.update(
      "project",
      "p-1",
      project(),
      "new-revision-text database",
      created.checksum,
    );
    release();
    await syncing;
    await framework.resync();
    const hits = (await framework.search({ query: "database", mode: "semantic" })).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.checksum).toBe(updated.checksum);
    expect(
      (await framework.search({ query: "old-revision-text", mode: "fulltext" })).hits,
    ).toHaveLength(0);
  });

  test("embedding failure leaves fulltext usable and vectors pending", async () => {
    const provider = new TestEmbeddingProvider();
    provider.beforeDocument = async () => {
      throw new Error("Provider temporarily offline");
    };
    const { framework } = await fixture({ provider });
    await framework.create("project", project(), "Recoverable fulltext content");
    const report = await framework.resync();
    expect(report.issues.some((issue) => issue.code === "EMBEDDING")).toBe(true);
    expect(framework.status().pendingEmbeddings).toBe(1);
    expect((await framework.search({ query: "Recoverable", mode: "fulltext" })).hits).toHaveLength(
      1,
    );
    provider.beforeDocument = undefined;
    await framework.resync();
    expect(framework.status().pendingEmbeddings).toBe(0);
  });

  test("invalid subsets, empty subsets, disabled semantics, symlinks and invalid schemas are handled", async () => {
    const { framework, root, directory } = await fixture();
    await expect(framework.search({ query: "x", types: ["unknown"] })).rejects.toMatchObject({
      code: "UNKNOWN_TYPE",
    });
    expect((await framework.search({ query: "x", types: [] })).hits).toEqual([]);
    await expect(framework.search({ query: "x", mode: "semantic" })).rejects.toMatchObject({
      code: "EMBEDDINGS_DISABLED",
    });
    await expect(
      framework.create("project", { ...project(), retiredAt: undefined }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await writeFile(path.join(directory, "outside.md"), "outside");
    await symlink(path.join(directory, "outside.md"), path.join(root, "projects", "linked.md"));
    const report = await framework.resync();
    expect(report.issues.some((issue) => issue.code === "SYMLINK")).toBe(true);
    expect(await readFile(path.join(directory, "outside.md"), "utf8")).toBe("outside");
  });

  test("a confirmed duplicate leaves search while an unrelated unseen object survives an incomplete scan", async () => {
    const { framework, root } = await fixture();
    const conflicted = await framework.create(
      "project",
      project("conflicted"),
      "Conflicted content",
    );
    const unseen = await framework.create(
      "adr",
      adr("a-unseen", "Unseen decision"),
      "Unseen content",
    );
    await framework.resync();
    expect(framework.status().objects).toBe(2);
    await writeFile(
      path.join(root, "projects", "duplicate.md"),
      await readFile(path.join(root, conflicted.path), "utf8"),
    );
    const resources = framework as unknown as { readonly store: FileStore };
    const walk = resources.store.files.walk.bind(resources.store.files);
    const unavailable = spyOn(resources.store.files, "walk").mockImplementation(
      async (directory, signal) => {
        const result = await walk(directory, signal);
        if (directory?.startsWith("adrs") !== true) return result;
        return {
          ...result,
          files: result.files.filter((file) => file.path !== unseen.path),
          complete: false,
          issues: [
            ...result.issues,
            { path: unseen.path, code: "DIRECTORY", message: "A subtree was unavailable" },
          ],
        };
      },
    );
    try {
      const report = await framework.resync();
      expect(report.issues.filter((issue) => issue.code === "DUPLICATE_ID")).toHaveLength(2);
      expect(report.issues.some((issue) => issue.code === "DIRECTORY")).toBe(true);
      // Only the confirmed conflict is dropped; the unseen cached row is left alone.
      expect(report.deleted).toBe(1);
      expect((await framework.search({ query: "Conflicted", mode: "fulltext" })).hits).toHaveLength(
        0,
      );
      expect((await framework.search({ query: "Unseen", mode: "fulltext" })).hits).toHaveLength(1);
      expect(framework.status().objects).toBe(1);
    } finally {
      unavailable.mockRestore();
    }
    // Once the duplicate is repaired and discovery is complete again, the
    // conflicted object must return to the index.
    await rm(path.join(root, "projects", "duplicate.md"));
    const repaired = await framework.resync();
    expect(repaired.issues.filter((issue) => issue.code === "DUPLICATE_ID")).toHaveLength(0);
    expect((await framework.search({ query: "Conflicted", mode: "fulltext" })).hits).toHaveLength(
      1,
    );
    expect(framework.status().objects).toBe(2);
  });

  test("an empty type selector is rejected instead of selecting every registered type", async () => {
    const { framework } = await fixture();
    await framework.create("project", project());
    await expect(framework.list("")).rejects.toMatchObject({ code: "UNKNOWN_TYPE" });
    await expect(framework.list("does_not_exist")).rejects.toMatchObject({ code: "UNKNOWN_TYPE" });
    expect((await framework.list("project")).total).toBe(1);
  });

  test("list and search enforce their documented boundaries", async () => {
    const { framework } = await fixture();
    await framework.create("project", project());
    await expect(framework.list("project", { limit: 0 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(framework.list("project", { limit: 1001 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(framework.list("project", { offset: -1 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect((await framework.list("project", { limit: 1 })).objects).toHaveLength(1);
    expect((await framework.list("project", { limit: 1000 })).total).toBe(1);
    expect((await framework.list("project", { offset: 0 })).total).toBe(1);
    const maxTopN = framework.config.search.maxTopN;
    await expect(framework.search({ query: "architecture", topN: 0 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      framework.search({ query: "architecture", topN: maxTopN + 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await framework.search({ query: "architecture", topN: maxTopN })).hits).toHaveLength(1);
  });

  test("the status report bounds its issue list and summarizes the rest", async () => {
    const { framework, root } = await fixture();
    const total = STATUS_ISSUE_LIMIT + 10;
    for (let index = 0; index < total; index++)
      await writeFile(
        path.join(root, "projects", `broken-${index}.md`),
        "---\nid: [broken\n---\nPreserve this text",
      );
    const report = await framework.resync();
    expect(report.issues).toHaveLength(total);
    const status = framework.status();
    expect(status.issues).toHaveLength(STATUS_ISSUE_LIMIT);
    expect(status.issuesTotal).toBe(total);
    expect(status.issuesTruncated).toBe(true);
    expect(status.issuesByCode).toEqual({ YAML: total });
    expect((status.issues as { path: string }[])[0]?.path).toBe("projects/broken-0.md");
    const lastSync = status.lastSync as {
      issues: unknown[];
      issuesTotal: number;
      issuesTruncated: boolean;
      issuesByCode: Record<string, number>;
    };
    expect(lastSync.issues).toHaveLength(STATUS_ISSUE_LIMIT);
    expect(lastSync.issuesTotal).toBe(total);
    expect(lastSync.issuesTruncated).toBe(true);
    expect(lastSync.issuesByCode).toEqual({ YAML: total });
    // The bounded copy must not shorten the report the resync tool returns.
    expect((await framework.resync()).issues).toHaveLength(total);
  });

  test("an embedding provider failure names the full-text recovery", async () => {
    const provider = new TestEmbeddingProvider();
    const { framework } = await fixture({ provider });
    await framework.create("project", project());
    let queryCalls = 0;
    provider.beforeQuery = async () => {
      queryCalls++;
      throw new Error("Provider temporarily offline");
    };
    for (const mode of ["semantic", "hybrid"] as const) {
      const failure = await framework
        .search({ query: "architecture", mode })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(FrameworkError);
      if (!(failure instanceof FrameworkError)) throw new Error("Expected a framework error.");
      expect(failure.code).toBe("EMBEDDINGS_UNAVAILABLE");
      expect(failure.message).toContain("Provider temporarily offline");
      expect(failure.message).toContain('Search with mode "fulltext"');
      expect((await framework.search({ query: "architecture", mode, types: [] })).hits).toEqual([]);
    }
    expect(queryCalls).toBe(2);
    expect((await framework.search({ query: "architecture", mode: "fulltext" })).hits).toHaveLength(
      1,
    );
    expect(queryCalls).toBe(2);
  });

  test("disabled providers preserve errors and allow explicit fulltext and empty type subsets", async () => {
    const { framework } = await fixture();
    await framework.create("project", project());
    for (const mode of ["semantic", "hybrid"] as const) {
      await expect(framework.search({ query: "architecture", mode })).rejects.toMatchObject({
        code: "EMBEDDINGS_DISABLED",
      });
      expect((await framework.search({ query: "architecture", mode, types: [] })).hits).toEqual([]);
      await expect(framework.search({ query: " ", mode, types: [] })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      await expect(
        framework.search({ query: "architecture", mode, types: [], topN: 0 }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect((await framework.search({ query: "architecture", mode: "fulltext" })).hits).toHaveLength(
      1,
    );
    expect((await framework.search({ query: "architecture" })).mode).toBe("fulltext");
  });

  test("lexical encoder overflow is INTERNAL rather than VALIDATION and is not truncated", async () => {
    const { framework } = await fixture();
    const query = Array.from({ length: 129 }, (_, index) => `word${index}`).join(" ");
    await expect(framework.search({ query, mode: "fulltext" })).rejects.toMatchObject({
      code: "INTERNAL",
    });
    expect((await framework.search({ query, mode: "fulltext", types: [] })).hits).toEqual([]);
    expect((await framework.search({ query: "***", mode: "fulltext" })).hits).toEqual([]);
  });

  test("an unknown type error names the registered types", async () => {
    const { framework } = await fixture();
    const failure = await framework.list("does_not_exist").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FrameworkError);
    if (!(failure instanceof FrameworkError)) throw new Error("Expected a framework error.");
    expect(failure.code).toBe("UNKNOWN_TYPE");
    expect(failure.message).toBe("Unknown object type 'does_not_exist'.");
    expect(failure.details.registeredTypes).toEqual(
      coreDefinitions.map((definition) => definition.name).sort(),
    );
  });

  test("onEvent reports every documented event kind and unsubscription stops delivery", async () => {
    const { framework, root } = await fixture({ watch: true });
    const events: FrameworkEvent[] = [];
    const unsubscribe = framework.onEvent((event) => events.push(event));
    const created = await framework.create("project", project(), "Body");
    expect(events).toContainEqual({
      kind: "object_created",
      source: "tool",
      type: "project",
      id: "p-1",
    });
    const raw = await readFile(path.join(root, created.path), "utf8");
    await writeFile(path.join(root, created.path), raw.replace("Body", "Edited body"));
    await eventually(() => events.some((event) => event.kind === "source_changed"));
    const changed = events.find((event) => event.kind === "source_changed");
    expect(changed).toMatchObject({ kind: "source_changed", source: "filesystem" });
    if (changed?.kind !== "source_changed") throw new Error("Expected a source change event.");
    expect(changed.path).toBe(created.path);
    const current = await framework.get("project", "p-1");
    const updated = await framework.update(
      "project",
      "p-1",
      project("p-1", "Updated"),
      "Updated body",
      current.checksum,
    );
    expect(events).toContainEqual({
      kind: "object_updated",
      source: "tool",
      type: "project",
      id: "p-1",
    });
    await framework.delete("project", "p-1", updated.checksum);
    expect(events).toContainEqual({
      kind: "object_deleted",
      source: "tool",
      type: "project",
      id: "p-1",
    });
    await framework.resync();
    const completed = events.find((event) => event.kind === "sync_completed");
    expect(completed).toMatchObject({ kind: "sync_completed", source: "filesystem" });
    if (completed?.kind !== "sync_completed") throw new Error("Expected a sync report.");
    expect(completed.report.scanned).toBeGreaterThan(0);
    unsubscribe();
    const delivered = events.length;
    await framework.resync();
    expect(events.length).toBe(delivered);
  });

  test("requestResync drives a recovery pass without an explicit resync", async () => {
    const { framework, root } = await fixture();
    const events: FrameworkEvent[] = [];
    framework.onEvent((event) => events.push(event));
    await framework.create("project", project(), "Body");
    await eventually(
      () => events.some((event) => event.kind === "sync_completed") && !framework.status().syncing,
    );
    events.length = 0;
    await writeFile(
      path.join(root, "projects", "recovered.md"),
      [
        "---",
        "id: recovered",
        "name: recovered",
        "title: Recovered project",
        "description: Recovered description",
        "createdAt: 2026-10-15T12:00:00.000Z",
        "updatedAt: 2026-10-15T12:00:00.000Z",
        "retiredAt: null",
        "tags: {}",
        "metadata: {}",
        "relations:",
        "  partOf: null",
        "---",
        "Recovered body",
        "",
      ].join("\n"),
    );
    framework.requestResync();
    await eventually(() => events.some((event) => event.kind === "sync_completed"));
    expect(framework.status().objects).toBe(2);
  });

  test("a non-finite decoded number is rejected before it can reach the vault file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "object-mcp-framework-"));
    tempDirs.push(directory);
    const registry = new ObjectRegistry(coreDefinitions).register({
      name: "measure",
      directory: "measures",
      description: "A type whose reading is decoded from a string.",
      schema: Schema.Struct({ ...BaseObjectSchema.fields, reading: Schema.NumberFromString }),
    });
    const framework = await createFramework({
      registry,
      baseDirectory: directory,
      config: {
        root: "objects",
        sqlite: { path: "cache/index.sqlite" },
        embeddings: { provider: "disabled" },
        sync: { watch: false, debounceMs: 20, rescanIntervalMs: 0 },
      },
    });
    open.push(framework);
    const failure = await framework
      .create("measure", measure("m-1", "abc"), "Body")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FrameworkError);
    if (!(failure instanceof FrameworkError)) throw new Error("Expected a framework error.");
    expect(failure.message).toContain("reading");
    expect(await readdir(path.join(directory, "objects", "measures"))).toEqual([]);
  });

  test("MCP creates a real file, returns ISO dates, searches it and closes cleanly", async () => {
    const { framework } = await fixture();
    const handler = createMcpHandler(() => createMcpServer(framework));
    const client = new Client(
      { name: "framework-integration", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://framework.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    try {
      expect((await client.listTools()).tools).toHaveLength(65);
      const registry = new ObjectRegistry(coreDefinitions);
      const created = await client.callTool({
        name: "project_create",
        arguments: {
          object: registry.encode("project", project()),
          body: "MCP integration content",
        },
      });
      expect(created.isError).not.toBe(true);
      const content = created.structuredContent as unknown as StoredObject;
      expect(content.object.createdAt as unknown).toBe("2026-10-15T12:00:00.000Z");
      const searched = await client.callTool({
        name: "objects_search",
        arguments: { query: "integration", mode: "fulltext", types: ["project"], topN: 1 },
      });
      expect(searched.isError).not.toBe(true);
      expect((searched.structuredContent as { hits: unknown[] }).hits).toHaveLength(1);
      expect(searched.structuredContent).toHaveProperty(
        "hits.0.fulltextExcerpt",
        expect.stringContaining("integration"),
      );
      expect((searched.structuredContent as { hits: unknown[] }).hits[0]).not.toHaveProperty(
        "body",
      );
      const deleted = await client.callTool({
        name: "project_delete",
        arguments: { id: "p-1", expectedChecksum: content.checksum },
      });
      expect(deleted.isError).not.toBe(true);
    } finally {
      await client.close();
      await handler.close();
    }
    expect((await framework.list("project")).total).toBe(0);
  });
});

describe("embedding preparation at startup", () => {
  test("preparing the embeddings calls the provider once and reports a failure without hiding it", async () => {
    const provider = new TestEmbeddingProvider();
    const { framework } = await fixture({ provider });
    try {
      await framework.prepareEmbeddings();
      expect(provider.prepareCalls).toBe(1);
      expect(framework.status().lastError).toBeNull();

      provider.prepareFailure = new Error("model snapshot is unreachable");
      const failure = await framework.prepareEmbeddings().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(provider.prepareCalls).toBe(2);
      const lastError = framework.status().lastError as { code: string; message: string } | null;
      expect(lastError?.message).toContain("model snapshot is unreachable");
    } finally {
      await framework.close();
    }
  });
});
