import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function waitForMarker(marker: string, timeoutMs: number): Promise<string> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (existsSync(marker)) return await readFile(marker, "utf8");
    await delay(10);
  }
  throw new Error(`Timed out waiting for subprocess marker ${path.basename(marker)}.`);
}

describe("resilient runtime cache contention", () => {
  test("serves source while a separate process holds the optional cache write lock", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "resilient-runtime-contention-"));
    roots.push(directory);
    const root = path.join(directory, "objects");
    const cache = path.join(directory, "cache", "index.sqlite");
    const lockMarker = path.join(directory, "lock-ready");
    const responseMarker = path.join(directory, "source-response");
    await mkdir(path.join(root, "projects"), { recursive: true });
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(
      path.join(root, "projects", "source.md"),
      [
        "---",
        "id: held-source",
        "name: held-source",
        "title: Held source",
        "description: Source remains available",
        "createdAt: 2026-10-15T12:00:00.000Z",
        "updatedAt: 2026-10-15T12:00:00.000Z",
        "retiredAt: null",
        "tags: {}",
        "metadata: {}",
        "relations:",
        "  partOf: null",
        "---",
        "Source remains responsive",
        "",
      ].join("\n"),
    );

    const lockScript = `
      import { Database } from "bun:sqlite";
      const db = new Database(${JSON.stringify(cache)});
      db.exec("PRAGMA journal_mode=WAL;");
      db.close();
      const holder = new Database(${JSON.stringify(cache)});
      holder.exec("BEGIN IMMEDIATE;");
      await Bun.write(${JSON.stringify(lockMarker)}, "LOCK_HELD");
      await Bun.stdin.stream().getReader().read();
      holder.exec("ROLLBACK;");
      holder.close();
    `;
    const runtimeModule = path.resolve(import.meta.dir, "../src/lib/resilient-runtime.ts");
    const configModule = path.resolve(import.meta.dir, "../src/lib/config.ts");
    const registryModule = path.resolve(import.meta.dir, "../src/registry.ts");
    const serveScript = `
      import { createResilientRuntime } from ${JSON.stringify(runtimeModule)};
      import { defineConfig } from ${JSON.stringify(configModule)};
      import { createCoreRegistry } from ${JSON.stringify(registryModule)};
      const config = defineConfig({
        root: ${JSON.stringify(root)},
        sqlite: { path: ${JSON.stringify(cache)}, driver: "bun", busyTimeoutMs: 10_000 },
        embeddings: { provider: "disabled" },
        sync: { watch: false, debounceMs: 0, rescanIntervalMs: 0 },
      });
      const runtime = await createResilientRuntime({
        config,
        definitions: createCoreRegistry().definitions,
      });
      const source = await runtime.get("project", "held-source");
      if (source.body !== "Source remains responsive\\n") throw new Error("Unexpected source body.");
      const capability = runtime.readiness();
      if (capability.state !== "failed") throw new Error("Optional cache did not fail fast.");
      await Bun.write(
        ${JSON.stringify(responseMarker)},
        "SOURCE_RESPONSE:" + capability.code,
      );
      await runtime.close();
    `;

    let holder: Bun.Subprocess | undefined;
    let serving: Bun.Subprocess | undefined;
    try {
      holder = Bun.spawn([process.execPath, "-e", lockScript], {
        cwd: path.resolve(import.meta.dir, ".."),
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await waitForMarker(lockMarker, 2_000)).toBe("LOCK_HELD");

      serving = Bun.spawn([process.execPath, "-e", serveScript], {
        cwd: path.resolve(import.meta.dir, ".."),
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await waitForMarker(responseMarker, 2_000)).toBe(
        "SOURCE_RESPONSE:CAPABILITY_START_FAILED",
      );
      expect(holder.exitCode).toBeNull();
      expect(await serving.exited).toBe(0);
      holder.kill();
      await holder.exited;
    } finally {
      if (serving && serving.exitCode === null) {
        serving.kill();
        await serving.exited;
      }
      if (holder && holder.exitCode === null) {
        holder.kill();
        await holder.exited;
      }
    }
  });
});
