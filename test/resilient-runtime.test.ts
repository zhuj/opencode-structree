import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createResilientRuntime } from "../src/lib/resilient-runtime.ts";
import type { ObjectFacade } from "../src/lib/types.ts";
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
  const directory = await mkdtemp(path.join(tmpdir(), "resilient-runtime-"));
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

function facade(onClose: () => void): ObjectFacade {
  return {
    definitions: [],
    config: { mcp: defaultConfig.mcp, search: defaultConfig.search },
    create: async () => {
      throw new Error("unused");
    },
    get: async () => {
      throw new Error("unused");
    },
    update: async () => {
      throw new Error("unused");
    },
    delete: async () => {
      throw new Error("unused");
    },
    list: async () => ({ objects: [], total: 0 }),
    search: async () => {
      throw new Error("unused");
    },
    relations: async () => {
      throw new Error("unused");
    },
    resync: async () => {
      throw new Error("unused");
    },
    status: () => ({}),
    close: async () => onClose(),
  };
}

describe("resilient runtime", () => {
  test("serves source while optional startup is pending and closes a late delegate once", async () => {
    const { root, config } = await fixture();
    await writeFile(
      path.join(root, "projects/readable.md"),
      "---\nid: readable\n---\nsource body\n",
    );
    let resolveFactory: ((value: ObjectFacade) => void) | undefined;
    let signal: AbortSignal | undefined;
    let closeCount = 0;
    const heldFactory = new Promise<ObjectFacade>((resolve) => {
      resolveFactory = resolve;
    });
    const runtime = await createResilientRuntime({
      config,
      definitions: createCoreRegistry().definitions,
      factory: (factorySignal) => {
        signal = factorySignal;
        return heldFactory;
      },
    });
    runtimes.push(runtime);

    const lateFacade = facade(() => {
      closeCount += 1;
    });
    try {
      expect((await runtime.get("project", "readable")).body).toBe("source body\n");
      expect(runtime.status()).toMatchObject({ sourceAvailable: true, source: "read-only" });
      await expect(runtime.create("project", {})).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
      });
      const closing = runtime.close();
      expect(signal?.aborted).toBe(true);
      if (!resolveFactory) throw new Error("Factory resolver was not initialized.");
      resolveFactory(lateFacade);
      await closing;
      expect(closeCount).toBe(1);
    } finally {
      const closing = runtime.close();
      resolveFactory?.(lateFacade);
      await closing;
    }
    await expect(readFile(path.join(root, "projects/readable.md"), "utf8")).resolves.toContain(
      "source body",
    );
    expect(() => runtime.get("project", "readable")).toThrow("Source access is closed.");
  });

  test("projects lexical search without renaming or changing authoritative source", async () => {
    const { root, config } = await fixture();
    const source = path.join(root, "projects/legacy-name.md");
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
        "Unique projection phrase",
        "",
      ].join("\n"),
    );
    const before = await readFile(source);
    const runtime = await createResilientRuntime({
      config,
      definitions: createCoreRegistry().definitions,
    });
    runtimes.push(runtime);

    await runtime.whenReady();
    expect(
      (await runtime.search({ query: "Unique projection phrase", mode: "fulltext" })).hits,
    ).toHaveLength(1);
    expect(await readFile(source)).toEqual(before);
    expect(await runtime.get("project", "p-1")).toMatchObject({ object: { id: "p-1" } });
    expect((await stat(path.join(root, ".object-mcp-lock.sqlite"))).isFile()).toBe(true);
  });

  test("does not create an absent source root", async () => {
    const { root, config } = await fixture();
    await rm(root, { recursive: true });

    await expect(
      createResilientRuntime({ config, definitions: createCoreRegistry().definitions }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, "projects"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps source readable and publishes only a safe failure when optional startup fails", async () => {
    const { root, config } = await fixture();
    await writeFile(path.join(root, "projects/readable.md"), "---\nid: readable\n---\nbody\n");
    const runtime = await createResilientRuntime({
      config,
      definitions: createCoreRegistry().definitions,
      factory: async () => {
        throw new Error("private startup detail");
      },
    });
    runtimes.push(runtime);

    await expect(runtime.whenReady()).rejects.toMatchObject({ code: "CAPABILITY_START_FAILED" });
    expect(runtime.readiness()).toEqual({ state: "failed", code: "CAPABILITY_START_FAILED" });
    expect((await runtime.get("project", "readable")).body).toBe("body\n");
    expect(JSON.stringify(runtime.status())).not.toContain("private startup detail");
  });
});
