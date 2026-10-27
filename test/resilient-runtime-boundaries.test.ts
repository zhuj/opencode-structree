import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "../src/lib/config.ts";
import { FileStore } from "../src/lib/filesystem.ts";
import { createResilientRuntime } from "../src/lib/resilient-runtime.ts";
import { createCoreRegistry } from "../src/registry.ts";

const roots: string[] = [];
const runtimes: Awaited<ReturnType<typeof createResilientRuntime>>[] = [];

afterEach(async () => {
  const failures: unknown[] = [];
  try {
    const closed = await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
    failures.push(
      ...closed.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
  } finally {
    const removed = await Promise.allSettled(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
    failures.push(
      ...removed.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
  }
  if (failures.length)
    throw new AggregateError(failures, "Resilient runtime fixture cleanup failed.");
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "resilient-runtime-boundaries-"));
  roots.push(directory);
  const root = path.join(directory, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  return {
    directory,
    root,
    config: defineConfig(
      {
        root,
        sqlite: { path: path.join(directory, "cache", "index.sqlite"), driver: "bun" },
        embeddings: { provider: "disabled" },
        sync: { watch: false, debounceMs: 0, rescanIntervalMs: 0 },
      },
      directory,
    ),
  };
}

describe("resilient runtime initialization boundaries", () => {
  test("uses invocation-time config and definition snapshots for the default writer", async () => {
    const { directory, root, config } = await fixture();
    const alternateRoot = path.join(directory, "alternate", "objects");
    const alternateCache = path.join(directory, "alternate-cache", "index.sqlite");
    const source = path.join(root, "projects", "legacy-name.md");
    await writeFile(
      source,
      [
        "---",
        "id: p-1",
        "name: p-1",
        "title: Existing title",
        "description: Architecture project",
        "createdAt: 2026-10-15T12:00:00.000Z",
        "updatedAt: 2026-10-15T12:00:00.000Z",
        "retiredAt: null",
        "tags: {}",
        "metadata: {}",
        "relations:",
        "  partOf: null",
        "---",
        "Invocation snapshot source",
        "",
      ].join("\n"),
    );
    const project = createCoreRegistry().definitions.find(({ name }) => name === "project");
    if (!project?.relations?.[0]) throw new Error("Core project definition is missing.");
    const relation = { ...project.relations[0] };
    const definition = { ...project, relations: [relation] };
    const definitions = [definition];
    const creation = createResilientRuntime({ config, definitions });

    Object.assign(config, {
      root: alternateRoot,
      sqlite: { ...config.sqlite, path: alternateCache },
    });
    Object.assign(definition, { name: "project_alias", directory: "aliases" });
    Object.assign(relation, { kind: "owns", targetType: "project_alias" });
    expect(Object.isFrozen(config)).toBe(false);
    expect(Object.isFrozen(config.sqlite)).toBe(false);
    expect(Object.isFrozen(definition)).toBe(false);
    expect(Object.isFrozen(relation)).toBe(false);

    const runtime = await creation;
    runtimes.push(runtime);
    await runtime.whenReady();
    expect((await runtime.get("project", "p-1")).body).toBe("Invocation snapshot source\n");
    const created = await runtime.create("project", {
      id: "p-2",
      name: "p-2",
      title: "Created in original source",
      description: "Snapshot target",
      createdAt: new Date("2026-10-15T12:00:00.000Z"),
      updatedAt: new Date("2026-10-15T12:00:00.000Z"),
      retiredAt: null,
      tags: {},
      metadata: {},
      relations: { partOf: null },
    });
    expect(created.path).toBe("projects/p-2.md");
    expect(await readFile(path.join(root, created.path), "utf8")).toContain(
      "Created in original source",
    );
    await expect(stat(alternateRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(alternateCache)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(root, "aliases"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("retains the real framework after first projection failure and resync recovers", async () => {
    const { root, config } = await fixture();
    const source = path.join(root, "projects", "legacy-name.md");
    await writeFile(
      source,
      [
        "---",
        "id: p-1",
        "name: p-1",
        "title: Existing title",
        "description: Architecture project",
        "createdAt: 2026-10-15T12:00:00.000Z",
        "updatedAt: 2026-10-15T12:00:00.000Z",
        "retiredAt: null",
        "tags: {}",
        "metadata: {}",
        "relations:",
        "  partOf: null",
        "---",
        "Projection recovery source",
        "",
      ].join("\n"),
    );
    const before = await readFile(source);
    const originalScan = FileStore.prototype.scan;
    let scanCount = 0;
    FileStore.prototype.scan = async function (
      this: FileStore,
      type?: string,
      signal?: AbortSignal,
    ) {
      scanCount += 1;
      if (scanCount === 1) throw new Error("transient initial projection failure");
      return originalScan.call(this, type, signal);
    };

    try {
      const runtime = await createResilientRuntime({
        config,
        definitions: createCoreRegistry().definitions,
      });
      runtimes.push(runtime);
      await runtime.whenReady();
      expect(scanCount).toBe(1);
      expect(runtime.readiness()).toEqual({ state: "ready" });
      expect((await runtime.get("project", "p-1")).body).toBe("Projection recovery source\n");
      expect((await runtime.resync()).issues).toEqual([]);
      expect(scanCount).toBeGreaterThanOrEqual(3);
      expect(await readFile(source)).toEqual(before);
    } finally {
      FileStore.prototype.scan = originalScan;
    }
  });
});
