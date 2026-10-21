import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { createFramework, type ObjectFramework } from "../src/framework.ts";
import { FrameworkError } from "../src/lib/errors.ts";
import { FileStore } from "../src/lib/filesystem.ts";
import type { SqliteIndex } from "../src/lib/sqlite/index.ts";
import type { EmbeddingProvider, SyncReport } from "../src/lib/types.ts";
import type { WatchLifecycle } from "../src/lib/vault/watch-lifecycle.ts";
import { FileWatcher } from "../src/lib/vault/watcher.ts";

const directories: string[] = [];
const frameworks: ObjectFramework[] = [];
const releaseWork: Array<() => void> = [];
afterEach(async () => {
  for (const release of releaseWork.splice(0)) release();
  await Promise.allSettled(frameworks.splice(0).map((framework) => framework.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function project(id: string, title = "Concurrent project") {
  return {
    id,
    name: id,
    title,
    description: "Lifecycle test",
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
    updatedAt: new Date("2026-10-18T00:00:00.000Z"),
    retiredAt: null,
    tags: {},
    metadata: {},
    relations: { partOf: null },
  };
}

async function fixture(
  options: {
    directory?: string;
    provider?: EmbeddingProvider;
    waitForStartup?: boolean;
    onError?: (error: FrameworkError) => void;
    watch?: boolean;
  } = {},
) {
  const directory =
    options.directory ?? (await mkdtemp(path.join(os.tmpdir(), "object-mcp-lifecycle-")));
  if (!options.directory) directories.push(directory);
  const framework = await createFramework({
    ...(options.waitForStartup === undefined ? {} : { waitForStartup: options.waitForStartup }),
    ...(options.onError ? { onError: options.onError } : {}),
    baseDirectory: directory,
    config: {
      root: "objects",
      sqlite: { path: "cache/index.sqlite" },
      embeddings: { provider: "disabled" },
      chunking: { size: 2000 },
      sync: {
        watch: options.watch ?? false,
        debounceMs: 60_000,
        rescanIntervalMs: 0,
        concurrency: 2,
        lockTimeoutMs: 2000,
      },
    },
    ...(options.provider ? { embeddingProvider: options.provider } : {}),
  });
  frameworks.push(framework);
  return { framework, directory, root: path.join(directory, "objects") };
}

class HeldEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 2;
  readonly fingerprint = "lifecycle-held-provider-v1";
  readonly entered = deferred();
  readonly fastAborted = deferred();
  readonly release = deferred();
  active = 0;
  started = 0;
  closeCalls = 0;
  closedWhileActive = false;
  constructor(
    private readonly expectedWorkers: number,
    private readonly asymmetric = false,
  ) {
    releaseWork.push(this.release.resolve);
  }
  async embed(
    texts: readonly string[],
    purpose: "query" | "document",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    if (purpose === "query") return texts.map(() => Float32Array.of(1, 0));
    this.active++;
    this.started++;
    if (this.started >= this.expectedWorkers) this.entered.resolve();
    try {
      if (this.asymmetric && texts.some((text) => text.includes("abortable-worker"))) {
        await new Promise<void>((_resolve, reject) => {
          const aborted = () => {
            this.fastAborted.resolve();
            reject(signal?.reason);
          };
          if (signal?.aborted) aborted();
          else signal?.addEventListener("abort", aborted, { once: true });
        });
      } else {
        // Native inference may finish only after cancellation has already reached another worker.
        await this.release.promise;
      }
      return texts.map(() => Float32Array.of(1, 0));
    } finally {
      this.active--;
    }
  }
  async close(): Promise<void> {
    this.closeCalls++;
    this.closedWhileActive ||= this.active > 0;
  }
}

describe("independent instances and lifecycle", () => {
  test("deferred startup is syncing and dirty even before the watcher is ready", async () => {
    const release = deferred();
    releaseWork.push(release.resolve);
    const start = FileWatcher.prototype.start;
    const observer = spyOn(FileWatcher.prototype, "start").mockImplementation(async function (
      this: FileWatcher,
      ...args
    ) {
      await release.promise;
      return start.apply(this, args);
    });
    try {
      const { framework } = await fixture({ waitForStartup: false, watch: true });
      expect(framework.status()).toMatchObject({ syncing: true, dirty: true, lastSync: null });
      release.resolve();
      await framework.waitForStartup();
      expect(framework.status()).toMatchObject({ syncing: false, dirty: false });
    } finally {
      release.resolve();
      observer.mockRestore();
    }
  });

  test("creation waits for startup by default and exposes the same startup report", async () => {
    const entered = deferred();
    const release = deferred();
    releaseWork.push(release.resolve);
    const scan = FileStore.prototype.scan;
    const observer = spyOn(FileStore.prototype, "scan").mockImplementation(async function (
      this: FileStore,
      ...args
    ) {
      entered.resolve();
      await release.promise;
      return scan.apply(this, args);
    });
    try {
      let created = false;
      const pending = fixture().then((result) => {
        created = true;
        return result;
      });
      await entered.promise;
      expect(created).toBe(false);
      release.resolve();
      const { framework } = await pending;
      expect(framework.status().lastSync).toMatchObject(await framework.waitForStartup());
      expect(framework.status()).toMatchObject({ syncing: false, dirty: false });
    } finally {
      release.resolve();
      observer.mockRestore();
    }
  });

  test("deferred startup exposes its running state, dirty follow-up, and completed report", async () => {
    const entered = deferred();
    const release = deferred();
    releaseWork.push(release.resolve);
    const scan = FileStore.prototype.scan;
    const observer = spyOn(FileStore.prototype, "scan").mockImplementation(async function (
      this: FileStore,
      ...args
    ) {
      entered.resolve();
      await release.promise;
      return scan.apply(this, args);
    });
    try {
      const { framework } = await fixture({ waitForStartup: false });
      await entered.promise;
      expect(framework.status()).toMatchObject({ syncing: true, dirty: false, lastSync: null });
      framework.requestResync();
      expect(framework.status()).toMatchObject({ syncing: true, dirty: true });
      const startup = framework.waitForStartup();
      release.resolve();
      const report = await startup;
      expect(report).toMatchObject({ scanned: 0, indexed: 0, issues: [] });
      expect(framework.status()).toMatchObject({ syncing: false, dirty: false, lastSync: report });
      expect(await framework.waitForStartup()).toBe(report);
    } finally {
      release.resolve();
      observer.mockRestore();
    }
  });

  test("a deferred startup failure is reported, remains awaitable, and leaves the framework open", async () => {
    const errors: FrameworkError[] = [];
    const failure = new FrameworkError("IO", "Startup scan failed");
    const observer = spyOn(FileStore.prototype, "scan").mockRejectedValue(failure);
    try {
      const { framework } = await fixture({
        waitForStartup: false,
        onError: (error) => {
          errors.push(error);
          throw new Error("Host error observer also failed");
        },
      });
      // Leave the startup unawaited for a turn: the framework must own its rejection handler.
      await delay(0);
      expect(errors).toEqual([failure]);
      await expect(framework.waitForStartup()).rejects.toBe(failure);
      expect(framework.status()).toMatchObject({
        syncing: false,
        dirty: false,
        lastSync: null,
        lastError: { code: "IO", message: "Startup scan failed" },
      });
      observer.mockRestore();
      expect((await framework.create("project", project("after-failure"))).object.id).toBe(
        "after-failure",
      );
    } finally {
      observer.mockRestore();
    }
  });

  test("close drains a deferred startup before disposing resources", async () => {
    const seed = await fixture();
    await seed.framework.create("project", project("startup-worker"), "Index on startup");
    await seed.framework.close();
    const provider = new HeldEmbeddingProvider(1);
    const { framework } = await fixture({
      directory: seed.directory,
      provider,
      waitForStartup: false,
    });
    await provider.entered.promise;
    const startup = framework.waitForStartup().catch((error: unknown) => error);
    let closed = false;
    const closing = framework.close().then(() => {
      closed = true;
    });
    await delay(0);
    expect(closed).toBe(false);
    expect(provider.closeCalls).toBe(0);
    provider.release.resolve();
    await Promise.all([startup, closing]);
    expect(provider.closedWhileActive).toBe(false);
    expect(provider.closeCalls).toBe(1);
  });

  test("independent framework instances cannot both update the same source revision", async () => {
    const first = await fixture();
    const created = await first.framework.create("project", project("shared"), "Initial");
    const second = await fixture({ directory: first.directory });
    const results = await Promise.allSettled([
      first.framework.update(
        "project",
        "shared",
        project("shared", "First"),
        "First writer",
        created.checksum,
      ),
      second.framework.update(
        "project",
        "shared",
        project("shared", "Second"),
        "Second writer",
        created.checksum,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "CHECKSUM_CONFLICT" });
    const readFirst = await first.framework.get("project", "shared");
    const readSecond = await second.framework.get("project", "shared");
    expect(readFirst).toEqual(readSecond);
    expect(await readFile(path.join(first.root, readFirst.path), "utf8")).toContain(readFirst.body);
    await Promise.all([first.framework.resync(), second.framework.resync()]);
    expect(first.framework.status().objects).toBe(1);
    expect(second.framework.status().objects).toBe(1);
  });

  test("cancelling a writer waiting for the process lock leaves no file and permits later writes", async () => {
    const { framework, root } = await fixture();
    const coordinator = new Database(path.join(root, ".object-mcp-lock.sqlite"));
    try {
      coordinator.exec("BEGIN IMMEDIATE");
      const controller = new AbortController();
      const reason = new DOMException("Cancelled while queued", "AbortError");
      const pending = framework
        .create("project", project("cancelled-writer"), "Must not be written", controller.signal)
        .catch((error: unknown) => error);
      await delay(20);
      controller.abort(reason);
      const failure = await pending;
      expect(failure).toBeInstanceOf(FrameworkError);
      if (!(failure instanceof FrameworkError)) throw new Error("Expected a framework error.");
      expect(failure.cause).toBe(reason);
      expect(failure.message).toBe("Cancelled while queued");
      expect((await framework.list("project")).total).toBe(0);
      coordinator.exec("ROLLBACK");
      const created = await framework.create("project", project("later-writer"), "Committed");
      expect(created.object.id).toBe("later-writer");
    } finally {
      if (coordinator.inTransaction) coordinator.exec("ROLLBACK");
      coordinator.close();
    }
  });

  test("cancelling one resync waiter does not cancel shared indexing for another waiter", async () => {
    const provider = new HeldEmbeddingProvider(1);
    const { framework } = await fixture({ provider });
    await framework.create("project", project("shared-indexing"), "Index me");
    const controller = new AbortController();
    const reason = new DOMException("Cancelled one waiter", "AbortError");
    const first = framework.resync(controller.signal).catch((error: unknown) => error);
    const second = framework.resync();
    await provider.entered.promise;
    controller.abort(reason);
    expect(await first).toBe(reason);
    expect(provider.active).toBe(1);
    expect(provider.closeCalls).toBe(0);
    provider.release.resolve();
    expect((await second).issues).toEqual([]);
    expect(framework.status().pendingEmbeddings).toBe(0);
    expect((await framework.search({ query: "Index", mode: "semantic" })).hits).toHaveLength(1);
  });

  test("close drains every embedding worker before disposing the provider or database", async () => {
    const provider = new HeldEmbeddingProvider(2, true);
    const { framework } = await fixture({ provider });
    await framework.create("project", project("abortable-worker"), "Fast cancellation");
    await framework.create("project", project("native-worker"), "Native inference completes later");
    const syncing = framework.resync().catch((error: unknown) => error);
    await provider.entered.promise;
    let closed = false;
    const closing = framework.close().then(() => {
      closed = true;
    });
    await provider.fastAborted.promise;
    await delay(20);
    const beforeNativeCompletes = {
      closeCalls: provider.closeCalls,
      active: provider.active,
      closed,
    };
    provider.release.resolve();
    await Promise.all([closing, syncing]);
    expect(beforeNativeCompletes).toEqual({ closeCalls: 0, active: 1, closed: false });
    expect(provider.closedWhileActive).toBe(false);
    expect(provider.active).toBe(0);
    expect(provider.closeCalls).toBe(1);
    await framework.close();
    expect(provider.closeCalls).toBe(1);
  });

  test("close attempts every owned resource despite multiple cleanup failures", async () => {
    const calls: string[] = [];
    const watcherFailure = new Error("Watcher cleanup failed");
    const runtimeFailure = new Error("Runtime cleanup failed");
    const providerFailure = new Error("Provider cleanup failed");
    const filesystemFailure = new Error("Filesystem cleanup failed");
    const provider: EmbeddingProvider = {
      dimensions: 2,
      fingerprint: "cleanup-failure-provider-v1",
      embed: async (texts) => texts.map(() => Float32Array.of(1, 0)),
      close: async () => {
        calls.push("provider");
        throw providerFailure;
      },
    };
    const { framework } = await fixture({ provider });
    const source = await framework.create("project", project("cleanup"), "Keep this file");
    const resources = framework as unknown as {
      readonly synchronization: WatchLifecycle<SyncReport>;
      readonly runtime: { dispose(): Promise<void> };
      readonly store: FileStore;
      readonly index: SqliteIndex;
    };
    const shutdown = resources.synchronization.shutdown.bind(resources.synchronization);
    const disposeRuntime = resources.runtime.dispose.bind(resources.runtime);
    const closeStore = resources.store.close.bind(resources.store);
    const closeIndex = resources.index.close.bind(resources.index);
    const observers = [
      spyOn(resources.synchronization, "shutdown").mockImplementation(async () => {
        await shutdown();
        calls.push("synchronization");
        throw watcherFailure;
      }),
      spyOn(resources.runtime, "dispose").mockImplementation(async () => {
        await disposeRuntime();
        calls.push("runtime");
        throw runtimeFailure;
      }),
      spyOn(resources.store, "close").mockImplementation(async () => {
        await closeStore();
        calls.push("store");
        throw filesystemFailure;
      }),
      spyOn(resources.index, "close").mockImplementation(() => {
        closeIndex();
        calls.push("index");
      }),
    ];
    try {
      const closing = framework.close();
      const failure: unknown = await closing.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError)) throw new Error("Expected cleanup failures.");
      expect(failure.errors).toEqual([
        watcherFailure,
        runtimeFailure,
        providerFailure,
        filesystemFailure,
      ]);
      expect(calls).toEqual(["synchronization", "runtime", "provider", "store", "index"]);
      expect(framework.close()).toBe(closing);
      expect(() => framework.status()).toThrow();
      expect(() => resources.index.status()).toThrow();
      await expect(resources.store.files.readText(source.path)).rejects.toMatchObject({
        code: "CLOSED",
      });
      expect(await readFile(path.join(framework.config.root, source.path), "utf8")).toContain(
        "Keep this file",
      );
    } finally {
      for (const observer of observers) observer.mockRestore();
    }
  });

  test("a startup error is retained when cleanup also fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "object-mcp-startup-failure-"));
    directories.push(directory);
    const blockedRoot = path.join(directory, "objects");
    await writeFile(blockedRoot, "A regular file cannot become the vault root");
    const providerFailure = new Error("Provider cleanup also failed");
    let closeCalls = 0;
    const provider: EmbeddingProvider = {
      dimensions: 2,
      fingerprint: "startup-failure-provider-v1",
      embed: async (texts) => texts.map(() => Float32Array.of(1, 0)),
      close: async () => {
        closeCalls++;
        throw providerFailure;
      },
    };
    const failure: unknown = await createFramework({
      baseDirectory: directory,
      config: {
        root: "objects",
        sqlite: { path: "cache/index.sqlite" },
        embeddings: { provider: "disabled" },
        sync: { watch: false, rescanIntervalMs: 0 },
      },
      embeddingProvider: provider,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error("Expected startup and cleanup errors.");
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toMatchObject({ code: "EEXIST" });
    expect(failure.cause).toBe(failure.errors[0]);
    expect(failure.errors[1]).toBeInstanceOf(AggregateError);
    expect((failure.errors[1] as AggregateError).errors).toEqual([providerFailure]);
    expect(closeCalls).toBe(1);
    expect(await readFile(blockedRoot, "utf8")).toBe("A regular file cannot become the vault root");
    await rm(blockedRoot);
    const recovered = await fixture({ directory });
    expect((await recovered.framework.create("project", project("recovered"))).object.id).toBe(
      "recovered",
    );
  });

  test("a partial vault walk cannot remove cached objects that it could not observe", async () => {
    const { framework, root } = await fixture();
    const visible = await framework.create("project", project("visible"), "Visible content");
    const unseen = await framework.create("project", project("unseen"), "Still authoritative");
    const resources = framework as unknown as { readonly store: FileStore };
    const walk = resources.store.files.walk.bind(resources.store.files);
    const original = await readFile(path.join(root, unseen.path), "utf8");
    const unavailable = spyOn(resources.store.files, "walk").mockImplementation(
      async (directory, signal) => {
        const result = await walk(directory, signal);
        if (!result.files.some((file) => file.path === unseen.path)) return result;
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
      expect(report.deleted).toBe(0);
      expect(report.issues).toContainEqual({
        path: unseen.path,
        code: "DIRECTORY",
        message: "A subtree was unavailable",
      });
      expect(framework.status().objects).toBe(2);
      await expect(framework.list("project")).rejects.toMatchObject({ code: "SCAN" });
      expect(await readFile(path.join(root, unseen.path), "utf8")).toBe(original);
      expect(await readFile(path.join(root, visible.path), "utf8")).toContain("Visible content");
    } finally {
      unavailable.mockRestore();
    }
    expect((await framework.list("project")).total).toBe(2);
    await rm(path.join(root, unseen.path));
    expect((await framework.resync()).deleted).toBe(1);
    expect(framework.status().objects).toBe(1);
  });

  test("deletion during deferred embedding converges within the shared resync without a watcher", async () => {
    const provider = new HeldEmbeddingProvider(1);
    const { framework, root } = await fixture({ provider });
    const source = await framework.create(
      "project",
      project("removed-while-embedding"),
      "This document will disappear before its vector is ready",
    );
    const syncing = framework.resync();
    await provider.entered.promise;
    await rm(path.join(root, source.path));
    provider.release.resolve();
    const report = await syncing;
    expect(report.deleted).toBe(1);
    expect(report.issues).toEqual([]);
    expect(framework.status().objects).toBe(0);
    expect(framework.status().pendingEmbeddings).toBe(0);
    expect(framework.status().dirty).toBe(false);
    expect((await framework.search({ query: "document", mode: "semantic" })).hits).toEqual([]);
  });

  test("rename during deferred embedding is corrected to the id name within the shared resync without a watcher", async () => {
    const provider = new HeldEmbeddingProvider(1);
    const { framework, root } = await fixture({ provider });
    const source = await framework.create(
      "project",
      project("renamed-while-embedding"),
      "Renamed document content",
    );
    const moved = path.posix.join(path.posix.dirname(source.path), "renamed.md");
    const syncing = framework.resync();
    await provider.entered.promise;
    await rename(path.join(root, source.path), path.join(root, moved));
    provider.release.resolve();
    const report = await syncing;
    expect(report.issues).toEqual([]);
    expect(framework.status().objects).toBe(1);
    expect(framework.status().pendingEmbeddings).toBe(0);
    expect(framework.status().dirty).toBe(false);
    expect((await framework.get("project", source.object.id)).path).toBe(source.path);
    const result = await framework.search({ query: "Renamed document", mode: "semantic" });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.path).toBe(source.path);
    expect(result.hits[0]?.checksum).toBe(source.checksum);
  });

  test("an encoding failure during publication is reported instead of being treated as an absent source", async () => {
    const provider = new HeldEmbeddingProvider(1);
    const { framework, root } = await fixture({ provider });
    const source = await framework.create("project", project("invalid-while-embedding"), "Valid");
    const filename = path.join(root, source.path);
    const syncing = framework.resync();
    await provider.entered.promise;
    await writeFile(filename, Buffer.from([0xff]));
    provider.release.resolve();
    const report = await syncing;
    expect(report.deleted).toBe(0);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ path: source.path, code: "EMBEDDING" });
    expect(report.issues[0]?.message).toContain("UTF-8");
    expect(framework.status().pendingEmbeddings).toBe(1);
    expect(await readFile(filename)).toEqual(Buffer.from([0xff]));
  });
});
