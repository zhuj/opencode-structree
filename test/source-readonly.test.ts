import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { FrameworkError } from "../src/lib/errors.ts";
import { FileStore } from "../src/lib/filesystem.ts";
import { ConfinedFilesystem } from "../src/lib/vault/confined-filesystem.ts";
import { coreDefinitions, createCoreRegistry } from "../src/registry.ts";

const directories: string[] = [];
const stores: FileStore[] = [];

afterEach(async () => {
  const closing = stores.splice(0).map((store) => store.close());
  const results = await Promise.allSettled(closing);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixture(): Promise<{
  directory: string;
  root: string;
  config: ReturnType<typeof defineConfig>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "source-readonly-"));
  directories.push(directory);
  const root = path.join(directory, "objects");
  return {
    directory,
    root,
    config: defineConfig(
      { ...defaultConfig, root, embeddings: { provider: "disabled" } },
      directory,
    ),
  };
}

async function inventory(directory: string): Promise<readonly string[]> {
  const paths: string[] = [];
  const visit = async (current: string, prefix = ""): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      paths.push(relative);
      if (entry.isDirectory()) await visit(path.join(current, entry.name), relative);
    }
  };
  await visit(directory);
  return paths.sort();
}

function project(id: string) {
  return {
    id,
    name: id,
    title: id,
    description: "Read-only fixture",
    createdAt: new Date("2026-10-15T12:00:00.000Z"),
    updatedAt: new Date("2026-10-15T12:00:00.000Z"),
    retiredAt: null,
    tags: {},
    metadata: {},
    relations: { partOf: null },
  };
}

describe("registry-aware source read-only access", () => {
  test("initializes and reads partial Markdown without creating registered directories or coordination state", async () => {
    const { root, config } = await fixture();
    await mkdir(path.join(root, "projects"), { recursive: true });
    const raw = "---\nid: kept\n---\nsource body\n";
    await writeFile(path.join(root, "projects/kept.md"), raw);
    const store = new FileStore(createCoreRegistry(), config, { access: "read-only" });
    stores.push(store);
    const before = await inventory(root);

    await store.initialize();
    const scan = await store.scan();
    const document = await store.get("project", "kept");

    expect(scan.documents).toHaveLength(1);
    expect(document.partial).toBe(true);
    expect(await store.readRaw("projects/kept.md")).toBe(raw);
    expect(await store.files.ensureDirectory("projects", false)).toBe(
      path.join(store.files.root, "projects"),
    );
    await expect(store.files.ensureDirectory("unit-tests", false)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await store.files.hash("projects/kept.md")).toBe(document.checksum);
    expect(scan.issues.map((issue) => issue.path)).toContain("unit-tests");
    expect((await store.files.walk()).files.map((file) => file.path)).toEqual(["projects/kept.md"]);
    expect(await inventory(root)).toEqual(before);
    expect(before).not.toContain(".object-mcp-lock.sqlite");
    expect(before).not.toContain("unit-tests");
  });

  test("leaves a missing root missing when read-only initialization fails", async () => {
    const { root, config } = await fixture();
    const store = new FileStore(createCoreRegistry(), config, { access: "read-only" });
    stores.push(store);

    await expect(store.initialize()).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("marks missing registered coverage incomplete before claiming an object is absent", async () => {
    const { root, config } = await fixture();
    await mkdir(path.join(root, "projects"), { recursive: true });
    await writeFile(path.join(root, "projects/kept.md"), "---\nid: kept\n---\nsource body\n");
    const store = new FileStore(createCoreRegistry(), config, { access: "read-only" });
    stores.push(store);
    await store.initialize();
    const before = await inventory(root);

    const all = await store.scan();
    const missingType = await store.scan("unit_test");

    expect(all.complete).toBe(false);
    expect(all.documents.map((document) => document.path)).toContain("projects/kept.md");
    expect(all.issues.map((issue) => issue.path)).toContain("unit-tests");
    expect(missingType.complete).toBe(false);
    expect(missingType.issues.map((issue) => issue.path)).toContain("unit-tests");
    await expect(store.get("unit_test", "missing")).rejects.toMatchObject({ code: "SCAN" });
    expect((await store.get("project", "kept")).path).toBe("projects/kept.md");
    expect(await inventory(root)).toEqual(before);
    expect(before).not.toContain("unit-tests");
    expect(before).not.toContain(".object-mcp-lock.sqlite");
  });

  test("preserves default write initialization and source creation", async () => {
    const { root, config } = await fixture();
    const store = new FileStore(createCoreRegistry(), config);
    stores.push(store);

    await store.initialize();
    const created = await store.create("project", project("writable"));

    expect(await readFile(path.join(root, created.path), "utf8")).toBe(created.raw);
    expect(await readdir(root)).toContain(".object-mcp-lock.sqlite");
    expect(await readdir(path.join(root, "unit-tests"))).toEqual([]);
  });

  test("keeps typed source mutation entry points read-only", async () => {
    const { root, config } = await fixture();
    await mkdir(path.join(root, "projects"), { recursive: true });
    const raw = "---\nid: kept\n---\nsource body\n";
    await writeFile(path.join(root, "projects/kept.md"), raw);
    const store = new FileStore(createCoreRegistry(), config, { access: "read-only" });
    stores.push(store);
    await store.initialize();
    const source = await store.get("project", "kept");

    const error = { code: "READ_ONLY" };
    await expect(store.files.ensureDirectory("unit-tests")).rejects.toMatchObject(error);
    await expect(store.files.stage("projects/new.md", "new")).rejects.toMatchObject(error);
    await expect(
      store.files.write("projects/new.md", "new", { expectedChecksum: null }),
    ).rejects.toMatchObject(error);
    const staging = new ConfinedFilesystem(root);
    await staging.initialize();
    const staged = await staging.stage("projects/staged.md", "staged");
    await expect(store.files.publish(staged, { expectedChecksum: null })).rejects.toMatchObject(
      error,
    );
    await staged.cleanup();
    await staging.close();
    await expect(
      store.files.renameBasename(source.path, "renamed.md", source.checksum),
    ).rejects.toMatchObject(error);
    await expect(store.files.delete(source.path, source.checksum)).rejects.toMatchObject(error);
    await expect(store.create("project", project("new"))).rejects.toMatchObject(error);
    await expect(
      store.update("project", "kept", project("kept"), "changed", source.checksum),
    ).rejects.toMatchObject(error);
    await expect(store.delete("project", "kept", source.checksum)).rejects.toMatchObject(error);
    await expect(store.withProcessLock(async () => undefined)).rejects.toMatchObject(error);
    expect(store.parse("project", source.path, raw)).toMatchObject({ partial: true });
    expect(await inventory(root)).toEqual(["projects", "projects/kept.md"]);
  });

  test("returns typed FrameworkError for read-only writes before initialization checks", async () => {
    const { config } = await fixture();
    const store = new FileStore(createCoreRegistry(), config, { access: "read-only" });
    stores.push(store);

    const failure = await store
      .withProcessLock(async () => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FrameworkError);
    if (!(failure instanceof FrameworkError)) throw new Error("Expected FrameworkError.");
    expect(failure.code).toBe("READ_ONLY");
  });

  test("keeps registered definitions aligned with the built-in registry", () => {
    expect(createCoreRegistry().definitions.map((definition) => definition.directory)).toEqual(
      coreDefinitions.map((definition) => definition.directory),
    );
  });

  test("bundles the source reader without eager native SQLite imports", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "source-readonly-bundle-"));
    directories.push(directory);
    const result = await Bun.build({
      entrypoints: [new URL("../src/lib/filesystem.ts", import.meta.url).pathname],
      outdir: path.join(directory, "bundle"),
      packages: "external",
      target: "bun",
    });
    expect(result.success).toBe(true);
    const output = result.outputs[0];
    if (!output) throw new Error("Expected the FileStore bundle output.");
    const source = await output.text();

    expect(source).not.toMatch(/^\s*import\s+.*(?:better-sqlite3|sqlite-vec)/m);
    expect(source).toMatch(
      /function openDatabase\(config\) \{[\s\S]*?require2\("better-sqlite3"\)/,
    );
    expect(source).not.toContain('from "sqlite-vec"');
  });
});
