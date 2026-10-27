import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCacheRecoveryController } from "../src/lib/cache-recovery/controller.ts";
import { defaultConfig } from "../src/lib/config.ts";
import { SqliteIndex } from "../src/lib/sqlite/index.ts";
import {
  controllerOptions,
  makeCacheRecoveryFixture,
  seedFromProject,
  writeProject,
} from "./cache-recovery-fixture.ts";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), "cache-recovery-controller-"));
  try {
    const root = await realpath(scratch);
    roots.push(root);
    return root;
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("cache recovery admission", () => {
  it("blocks missing maintenance capability before filesystem effects", async () => {
    const root = await fixture();
    const controller = createCacheRecoveryController({
      enabled: true,
      allowSemanticReset: true,
      authorizedDirectory: root,
      relativeTarget: "cache.sqlite",
      sourceRoot: path.join(root, "sources"),
      workerEntrypoint: path.join(root, "worker.ts"),
      sqlite: { path: path.join(root, "cache.sqlite"), driver: "bun", busyTimeoutMs: 0 },
      search: {
        defaultTopN: 5,
        maxTopN: 20,
        candidateMultiplier: 3,
        rrfK: 60,
        fulltextWeight: 0.5,
        semanticWeight: 0.5,
        maxMatchCharacters: 200,
      },
    });
    try {
      expect(await controller.recover()).toMatchObject({
        status: "blocked",
        code: "MAINTENANCE_REQUIRED",
      });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await controller.close();
    }
  });

  it("rebuilds lexical metadata in an owned Bun child and retains the exact old cache", async () => {
    const fixture = await makeCacheRecoveryFixture("bun");
    roots.push(fixture.root);
    const staleRoot = path.join(fixture.root, "stale-source");
    await mkdir(staleRoot);
    await writeProject(staleRoot, "obsolete", "obsoleteonlyword");
    await seedFromProject(staleRoot, fixture.target, "bun");
    const oldBytes = await readFile(fixture.target);
    const newSource = await writeProject(fixture.sourceRoot, "current", "currentlexicalneedle");
    const sourceBytes = await readFile(newSource);
    let maintenanceCalls = 0;
    let held = false;
    const controller = createCacheRecoveryController(
      controllerOptions(fixture, "bun", async (_request, operation) => {
        maintenanceCalls++;
        held = true;
        try {
          return await operation();
        } finally {
          held = false;
        }
      }),
    );
    try {
      let parentMarker = false;
      const running = controller.recover();
      queueMicrotask(() => {
        parentMarker = true;
      });
      await Promise.resolve();
      expect(parentMarker).toBe(true);
      const result = await running;
      expect(result).toMatchObject({
        status: "recovered",
        code: "CACHE_REBUILT",
        files: 1,
        objects: 1,
        semantic: "unavailable",
      });
      expect(maintenanceCalls).toBe(1);
      expect(held).toBe(false);
      expect(await readFile(newSource)).toEqual(sourceBytes);
      if (result.status !== "recovered") throw new Error("Expected cache rebuild result.");
      const targetKey = createHash("sha256")
        .update(JSON.stringify([fixture.cacheRoot, "cache.sqlite"]))
        .digest("hex");
      const backup = path.join(
        fixture.cacheRoot,
        ".object-mcp-cache-recovery",
        targetKey,
        "backups",
        `${result.actionId}.old.sqlite`,
      );
      expect(await readFile(backup)).toEqual(oldBytes);
      await controller.close();
      let restartCalls = 0;
      const restarted = createCacheRecoveryController(
        controllerOptions(fixture, "bun", async (_request, operation) => {
          restartCalls++;
          return operation();
        }),
      );
      try {
        expect(await restarted.recover()).toMatchObject({
          status: "already-satisfied",
          code: "CACHE_CURRENT",
          actionId: result.actionId,
        });
        expect(restartCalls).toBe(1);
        expect(await readdir(path.dirname(backup))).toEqual([`${result.actionId}.old.sqlite`]);
      } finally {
        await restarted.close();
      }
      const index = new SqliteIndex(
        { ...defaultConfig.sqlite, path: fixture.target, driver: "bun", busyTimeoutMs: 0 },
        defaultConfig.search,
      );
      try {
        const status = index.status();
        expect(status.embeddingRows).toBe(0);
        const found = index.search({ query: "currentlexicalneedle", mode: "fulltext", topN: 5 });
        expect(found.hits.some((hit) => hit.type === "project" && hit.id === "current")).toBe(true);
        expect(found.hits.some((hit) => hit.type === "project" && hit.id === "obsolete")).toBe(
          false,
        );
      } finally {
        index.close();
      }
    } finally {
      await controller.close();
    }
  });

  it("coalesces concurrent explicit requests under one maintenance operation", async () => {
    const fixture = await makeCacheRecoveryFixture("bun");
    roots.push(fixture.root);
    let openBarrier: (() => void) | undefined;
    const release = () => openBarrier?.();
    const barrier = new Promise<void>((resolve) => {
      openBarrier = resolve;
    });
    let calls = 0;
    const controller = createCacheRecoveryController(
      controllerOptions(fixture, "bun", async (_request, operation) => {
        calls++;
        await barrier;
        return operation();
      }),
    );
    try {
      const first = controller.recover();
      const second = controller.recover();
      expect(calls).toBe(1);
      release();
      const [left, right] = await Promise.all([first, second]);
      expect(left).toEqual(right);
      expect(left).toMatchObject({ status: "recovered", code: "CACHE_REBUILT" });
      expect(calls).toBe(1);
    } finally {
      release();
      await controller.close();
    }
  });

  it("blocks missing semantic-reset consent without touching the cache", async () => {
    const fixture = await makeCacheRecoveryFixture("bun");
    roots.push(fixture.root);
    const before = await readFile(fixture.target);
    const options = controllerOptions(fixture, "bun", async (_request, operation) => operation());
    const controller = createCacheRecoveryController({ ...options, allowSemanticReset: false });
    try {
      expect(await controller.recover()).toMatchObject({
        status: "blocked",
        code: "SEMANTIC_RESET_NOT_APPROVED",
      });
      expect(await readFile(fixture.target)).toEqual(before);
      expect(await readdir(fixture.cacheRoot)).toEqual(["cache.sqlite"]);
    } finally {
      await controller.close();
    }
  });

  it("rejects a target with residual WAL before creating recovery artifacts", async () => {
    const fixture = await makeCacheRecoveryFixture("bun");
    roots.push(fixture.root);
    const sidecar = `${fixture.target}-wal`;
    await writeFile(sidecar, "preserve");
    const before = await readFile(fixture.target);
    let calls = 0;
    const controller = createCacheRecoveryController(
      controllerOptions(fixture, "bun", async (_request, operation) => {
        calls++;
        return operation();
      }),
    );
    try {
      expect(await controller.recover()).toMatchObject({
        status: "blocked",
        code: "TARGET_NOT_ADMISSIBLE",
      });
      expect(calls).toBe(1);
      expect(await readFile(fixture.target)).toEqual(before);
      expect(await readFile(sidecar, "utf8")).toBe("preserve");
      expect(await readdir(fixture.cacheRoot)).toEqual(["cache.sqlite", "cache.sqlite-wal"]);
    } finally {
      await controller.close();
    }
  });

  it("cancels and reaps the owned child before returning the maintenance result", async () => {
    const fixture = await makeCacheRecoveryFixture("bun");
    roots.push(fixture.root);
    const before = await readFile(fixture.target);
    const abort = new AbortController();
    const controller = createCacheRecoveryController(
      controllerOptions(fixture, "bun", async (_request, operation) => {
        const job = operation();
        abort.abort();
        return await job;
      }),
    );
    try {
      expect(await controller.recover({ signal: abort.signal })).toMatchObject({
        status: "cancelled",
        code: "CANCELLED",
      });
      expect(await readFile(fixture.target)).toEqual(before);
      expect(await readdir(fixture.cacheRoot)).toEqual(["cache.sqlite"]);
    } finally {
      await controller.close();
    }
  });
});
