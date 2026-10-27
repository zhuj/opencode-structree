import { afterEach, expect, it } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createCacheRecoveryController } from "../src/lib/cache-recovery/controller.ts";
import { collectCacheSources } from "../src/lib/cache-recovery/sources.ts";
import { runRecoveryWorker } from "../src/lib/cache-recovery/worker-client.ts";
import { defaultConfig } from "../src/lib/config.ts";
import { SqliteIndex } from "../src/lib/sqlite/index.ts";
import { coreDefinitions } from "../src/registry.ts";
import {
  controllerOptions,
  makeCacheRecoveryFixture,
  writeProject,
} from "./cache-recovery-fixture.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

it("rebuilds a real better-sqlite3 cache through the owned Bun worker", async () => {
  const fixture = await makeCacheRecoveryFixture("better-sqlite3");
  roots.push(fixture.root);
  await writeProject(fixture.sourceRoot, "worker", "betterdriverlexicalmark");
  let boundaryHeld = false;
  const controller = createCacheRecoveryController(
    controllerOptions(fixture, "better-sqlite3", async (_request, operation) => {
      boundaryHeld = true;
      try {
        return await operation();
      } finally {
        boundaryHeld = false;
      }
    }),
  );
  try {
    let eventLoopMarker = false;
    const job = controller.recover();
    queueMicrotask(() => {
      eventLoopMarker = true;
    });
    await Promise.resolve();
    expect(eventLoopMarker).toBe(true);
    expect(await job).toMatchObject({
      status: "recovered",
      code: "CACHE_REBUILT",
      files: 1,
      objects: 1,
      semantic: "unavailable",
    });
    expect(boundaryHeld).toBe(false);
    const index = new SqliteIndex(
      { ...defaultConfig.sqlite, path: fixture.target, driver: "better-sqlite3", busyTimeoutMs: 0 },
      defaultConfig.search,
    );
    try {
      expect(index.status().embeddingRows).toBe(0);
      expect(
        index
          .search({ query: "betterdriverlexicalmark", mode: "fulltext", topN: 5 })
          .hits.some((hit) => hit.type === "project" && hit.id === "worker"),
      ).toBe(true);
    } finally {
      index.close();
    }
  } finally {
    await controller.close();
  }
});

it("kills and reaps a worker at the configured hard budget before releasing maintenance", async () => {
  const fixture = await makeCacheRecoveryFixture("bun");
  roots.push(fixture.root);
  const before = await readFile(fixture.target);
  let held = false;
  let releasedAfterOutcome = false;
  const controller = createCacheRecoveryController({
    ...controllerOptions(fixture, "bun", async (_request, operation) => {
      held = true;
      try {
        const result = await operation();
        releasedAfterOutcome = true;
        return result;
      } finally {
        held = false;
      }
    }),
    totalBudgetMs: 1,
  });
  try {
    expect(await controller.recover()).toMatchObject({ status: "failed", code: "WORKER_TIMEOUT" });
    expect(held).toBe(false);
    expect(releasedAfterOutcome).toBe(true);
    expect(await readFile(fixture.target)).toEqual(before);
  } finally {
    await controller.close();
  }
});

it("terminates an actual Bun worker on its deadline and awaits process close", async () => {
  const fixture = await makeCacheRecoveryFixture("bun");
  roots.push(fixture.root);
  const result = await runRecoveryWorker({
    entrypoint: fixture.workerEntrypoint,
    cwd: fixture.cacheRoot,
    request: { version: 1, operation: "collect", sourceRoot: fixture.sourceRoot },
    timeoutMs: 1,
    signal: new AbortController().signal,
  });
  expect(result).toEqual({ status: "blocked", code: "WORKER_TIMEOUT" });
});

it("indexes a fully-read semantically partial Markdown document without changing its bytes", async () => {
  const fixture = await makeCacheRecoveryFixture("bun");
  roots.push(fixture.root);
  const sourcePath = await writeProject(fixture.sourceRoot, "partial", "partialsourcelexeme");
  const original = await readFile(sourcePath, "utf8");
  const partial = original.replace("description: Synthetic fixture.\n", "");
  await writeFile(sourcePath, partial);
  const sources = await collectCacheSources({
    root: fixture.sourceRoot,
    definitions: coreDefinitions,
  });
  expect(sources.status).toBe("complete");
  if (sources.status === "complete") expect(sources.documents[0]?.partial).toBe(true);
  const controller = createCacheRecoveryController(
    controllerOptions(fixture, "bun", async (_request, operation) => operation()),
  );
  try {
    expect(await controller.recover()).toMatchObject({ status: "recovered", files: 1, objects: 1 });
    expect(await readFile(sourcePath, "utf8")).toBe(partial);
    const index = new SqliteIndex(
      { ...defaultConfig.sqlite, path: fixture.target, driver: "bun", busyTimeoutMs: 0 },
      defaultConfig.search,
    );
    try {
      const hits = index.search({ query: "partialsourcelexeme", mode: "fulltext", topN: 5 }).hits;
      expect(hits.some((hit) => hit.type === "project" && hit.id === "partial")).toBe(true);
      expect(index.status().embeddingRows).toBe(0);
    } finally {
      index.close();
    }
  } finally {
    await controller.close();
  }
});
