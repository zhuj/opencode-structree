import { expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { collectCacheSources } from "../src/lib/cache-recovery/sources.ts";
import { runRecoveryWorker } from "../src/lib/cache-recovery/worker-client.ts";
import { coreDefinitions } from "../src/registry.ts";
import {
  makeCacheRecoveryFixture,
  seedFromProject,
  writeProject,
} from "./cache-recovery-fixture.ts";

it("rejects a structurally valid cache with the right row count but wrong source projection", async () => {
  const fixture = await makeCacheRecoveryFixture();
  try {
    const stale = path.join(fixture.root, "stale");
    await mkdir(stale);
    await writeProject(stale, "obsolete", "stalelexeme");
    await seedFromProject(stale, fixture.target, "bun", false);
    await writeProject(fixture.sourceRoot, "current", "newlexeme");
    const sources = await collectCacheSources({
      root: fixture.sourceRoot,
      definitions: coreDefinitions,
    });
    if (sources.status !== "complete") throw new Error("Expected complete synthetic source.");
    const inspect = await runRecoveryWorker({
      entrypoint: fixture.workerEntrypoint,
      cwd: fixture.cacheRoot,
      request: {
        version: 1,
        operation: "inspect",
        root: fixture.cacheRoot,
        relativeFilename: "cache.sqlite",
        maxBytes: 64 * 1024 * 1024,
      },
      timeoutMs: 5000,
      signal: new AbortController().signal,
    });
    expect(inspect.status).toBe("ok");
    if (
      inspect.status !== "ok" ||
      inspect.reply.status !== "ok" ||
      inspect.reply.operation !== "inspect"
    )
      throw new Error("Expected valid current cache.");
    expect(inspect.reply.objectCount).toBe(1);
    const verified = await runRecoveryWorker({
      entrypoint: fixture.workerEntrypoint,
      cwd: fixture.cacheRoot,
      request: {
        version: 1,
        operation: "verify",
        root: fixture.cacheRoot,
        relativeFilename: "cache.sqlite",
        maxBytes: 64 * 1024 * 1024,
        expectedChecksum: inspect.reply.checksum,
        sourceRoot: fixture.sourceRoot,
        expectedFingerprint: sources.fingerprint,
      },
      timeoutMs: 5000,
      signal: new AbortController().signal,
    });
    expect(verified).toMatchObject({
      status: "ok",
      reply: { status: "blocked", code: "CANDIDATE_METADATA" },
    });
  } finally {
    await fixture.cleanup();
  }
});
