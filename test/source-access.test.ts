import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import type { ObjectFacade } from "../src/lib/types.ts";
import { createCoreRegistry } from "../src/registry.ts";

const roots: string[] = [];
const accesses: Awaited<ReturnType<typeof createSourceAccess>>[] = [];

afterEach(async () => {
  const results = await Promise.allSettled(accesses.splice(0).map((access) => access.close()));
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; config: ReturnType<typeof defineConfig> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "source-access-"));
  roots.push(directory);
  const root = path.join(directory, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  return {
    root,
    config: defineConfig(
      { ...defaultConfig, root, embeddings: { provider: "disabled" } },
      directory,
    ),
  };
}

function create(options: {
  readonly root: string;
  readonly config: ReturnType<typeof defineConfig>;
  readonly factory?: (signal: AbortSignal) => Promise<ObjectFacade>;
}) {
  return createSourceAccess({
    config: options.config,
    definitions: createCoreRegistry().definitions,
    ...(options.factory ? { factory: options.factory } : {}),
  });
}

function capabilityFacade(onClose: () => void = () => undefined): ObjectFacade {
  return {
    definitions: [],
    create: async () => ({
      type: "project",
      object: {
        id: "delegated",
        name: "delegated",
        title: "delegated",
        description: "delegated",
        createdAt: new Date(0),
        updatedAt: new Date(0),
        retiredAt: null,
        tags: {},
        metadata: {},
        relations: {},
      },
      body: "",
      path: "projects/delegated.md",
      checksum: "checksum",
    }),
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

describe("source access", () => {
  test("serves source while an optional capability startup fails", async () => {
    const { root, config } = await fixture();
    await writeFile(path.join(root, "projects/readable.md"), "---\nid: readable\n---\nbody\n");
    const access = await create({
      root,
      config,
      factory: async () => Promise.reject(new Error("private")),
    });
    accesses.push(access);

    const object = await access.get("project", "READABLE");
    const listing = await access.list("project");

    expect(object.object.id).toBe("readable");
    expect(listing.objects).toHaveLength(1);
    expect(access.readiness()).toMatchObject({ state: "failed", code: "CAPABILITY_START_FAILED" });
    expect(access.status()).toMatchObject({ sourceAvailable: true });
    expect(JSON.stringify(access.status())).not.toContain("private");
    expect(await readdir(root)).toEqual(["projects"]);
  });

  test("returns a readable target with unverified identity when a sibling cannot be decoded", async () => {
    const { root, config } = await fixture();
    await writeFile(path.join(root, "projects/readable.md"), "---\nid: readable\n---\nbody\n");
    await writeFile(path.join(root, "projects/broken.md"), Buffer.from([0xff, 0xfe]));
    const access = await create({ root, config });
    accesses.push(access);

    const object = await access.get("project", "readable");

    expect("assurance" in object ? object.assurance : undefined).toMatchObject({
      complete: false,
      identity: "unverified",
    });
    const listing = await access.list("project");
    expect(listing.issues?.map(({ path: issuePath, code }) => ({ path: issuePath, code }))).toEqual(
      expect.arrayContaining([
        { path: "projects/broken.md", code: "ENCODING" },
        { path: "projects/readable.md", code: "VALIDATION" },
      ]),
    );
  });

  test("honors caller cancellation for source reads", async () => {
    const { config } = await fixture();
    const access = await create({ root: config.root, config });
    accesses.push(access);
    const cancellation = new AbortController();
    cancellation.abort();

    await expect(access.list("project", {}, cancellation.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  test("does not turn an uncertain absent target into not found", async () => {
    const { config } = await fixture();
    const access = await create({ root: config.root, config });
    accesses.push(access);

    await expect(access.get("unit_test", "missing")).rejects.toMatchObject({ code: "SCAN" });
    expect(await readdir(config.root)).toEqual(["projects"]);
  });

  test("keeps fully observed semantic parse issues from making list incomplete", async () => {
    const { root, config } = await fixture();
    await writeFile(path.join(root, "projects/good.md"), "---\nid: good\n---\nbody\n");
    await writeFile(path.join(root, "projects/partial.md"), "---\nid: partial\n---\nbody\n");
    const access = await create({ root, config });
    accesses.push(access);

    const result = await access.list("project");

    expect(result.complete).toBe(true);
    expect(result.total).toBe(2);
  });

  test("rejects observed duplicate identities without selecting either copy", async () => {
    const { root, config } = await fixture();
    await mkdir(path.join(root, "projects", "nested"));
    await writeFile(path.join(root, "projects/one.md"), "---\nid: repeated\n---\none\n");
    await writeFile(path.join(root, "projects/nested/two.md"), "---\nid: repeated\n---\ntwo\n");
    const access = await create({ root, config });
    accesses.push(access);

    await expect(access.get("project", "repeated")).rejects.toMatchObject({
      code: "DUPLICATE_ID",
      details: { candidates: ["projects/nested/two.md", "projects/one.md"] },
    });
  });

  test("rejects mutations before and after optional capability readiness", async () => {
    const { root, config } = await fixture();
    let resolve: ((facade: ObjectFacade) => void) | undefined;
    const startup = new Promise<ObjectFacade>((done) => {
      resolve = done;
    });
    const access = await create({ root, config, factory: async () => startup });
    accesses.push(access);

    await expect(access.create("project", {})).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
    if (!resolve) throw new Error("Factory resolver was not initialized.");
    resolve(capabilityFacade());
    await access.whenReady();
    expect((await access.create("project", {})).object.id).toBe("delegated");
  });

  test("keeps source reads available after a derived capability operation fails", async () => {
    const { root, config } = await fixture();
    await writeFile(path.join(root, "projects/readable.md"), "---\nid: readable\n---\nbody\n");
    const failedFacade: ObjectFacade = {
      ...capabilityFacade(),
      create: async () => {
        throw new Error("derived failure");
      },
    };
    const access = await create({ root, config, factory: async () => failedFacade });
    accesses.push(access);
    await access.whenReady();

    await expect(access.create("project", {})).rejects.toThrow("derived failure");
    expect((await access.get("project", "readable")).object.id).toBe("readable");
    expect((await access.list("project")).objects).toHaveLength(1);
  });

  test("aborts pending startup and closes a late capability once during idempotent close", async () => {
    const { config } = await fixture();
    let resolve: ((facade: ObjectFacade) => void) | undefined;
    let startupSignal: AbortSignal | undefined;
    let closeCount = 0;
    const startup = new Promise<ObjectFacade>((done) => {
      resolve = done;
    });
    const access = await create({
      root: config.root,
      config,
      factory: async (signal) => {
        startupSignal = signal;
        return startup;
      },
    });
    const closing = access.close();
    const closingAgain = access.close();

    expect(startupSignal?.aborted).toBe(true);
    if (!resolve) throw new Error("Factory resolver was not initialized.");
    resolve(
      capabilityFacade(() => {
        closeCount += 1;
      }),
    );
    await Promise.all([closing, closingAgain]);

    expect(closeCount).toBe(1);
    expect(access.readiness()).toEqual({ state: "closed" });
    await expect((async () => await access.get("project", "closed"))()).rejects.toMatchObject({
      code: "CLOSED",
    });
  });
});
