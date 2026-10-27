import { constants, Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, opendir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createCacheRecoveryController,
  type ExclusiveMaintenanceRequest,
} from "../src/lib/cache-recovery/controller.ts";
import { copyOptions } from "../src/lib/cache-recovery/controller-types.ts";
import { defaultConfig } from "../src/lib/config.ts";
import { CacheDatabase } from "../src/lib/sqlite/cache-database.ts";
import { writeProject } from "./cache-recovery-fixture.ts";

async function inventory(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(relative: string): Promise<void> {
    const directory = await opendir(path.join(root, relative));
    try {
      while (true) {
        const entry = await directory.read();
        if (!entry) break;
        const name = path.join(relative, entry.name);
        found.push(name);
        if (found.length > 100) throw new Error("FIXTURE_INVENTORY_LIMIT");
        if (entry.isDirectory()) await walk(name);
      }
    } finally {
      await directory.close();
    }
  }
  await walk("");
  return found.sort();
}

function projection(file: string, id: string): boolean {
  const url = pathToFileURL(file);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  const database = new Database(
    url.href,
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
  );
  try {
    const row: unknown = database.query("SELECT id FROM object_meta").get();
    return typeof row === "object" && row !== null && "id" in row && row.id === id;
  } finally {
    database.close();
  }
}

async function scenario(root: string, mode: string) {
  const worker = await realpath(
    fileURLToPath(new URL("../src/cache-recovery-worker.ts", import.meta.url)),
  );
  const originalWorker = await readFile(worker, "utf8");
  const relocatedWorker = originalWorker
    .replace(/"\.\/lib\/cache-recovery\/([a-z-]+\.ts)"/g, (_match: string, filename: string) =>
      JSON.stringify(new URL(`../src/lib/cache-recovery/${filename}`, import.meta.url).href),
    )
    .replace(
      '"./registry.ts"',
      JSON.stringify(new URL("../src/registry.ts", import.meta.url).href),
    );
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  for (const directory of [a, b]) {
    await mkdir(directory);
    await mkdir(path.join(directory, "cache"));
    await mkdir(path.join(directory, "sources"));
    await writeFile(path.join(directory, "worker.ts"), relocatedWorker);
    const cache = new CacheDatabase({
      ...defaultConfig.sqlite,
      path: path.join(directory, "cache/cache.sqlite"),
      driver: "bun",
      busyTimeoutMs: 0,
    });
    try {
      cache.raw.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    } finally {
      cache.close();
    }
  }
  const aSource = await writeProject(path.join(a, "sources"), "from-a", "a-source-marker");
  const bSource = await writeProject(path.join(b, "sources"), "from-b", "b-source-marker");
  const aBytes = await readFile(path.join(a, "cache/cache.sqlite"));
  const bBytes = await readFile(path.join(b, "cache/cache.sqlite"));
  const aSourceBytes = await readFile(aSource);
  const bSourceBytes = await readFile(bSource);
  const bInventory = await inventory(b);
  process.chdir(a);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let fence: string | undefined;
  const options = {
    enabled: true,
    allowSemanticReset: true,
    authorizedDirectory: "cache",
    relativeTarget: "cache.sqlite",
    sourceRoot: "sources",
    workerEntrypoint: mode === "relative-worker" ? "worker.ts" : worker,
    sqlite: {
      ...defaultConfig.sqlite,
      path: "cache/cache.sqlite",
      driver: "bun" as const,
      busyTimeoutMs: 0,
    },
    search: { ...defaultConfig.search },
    withExclusiveCacheMaintenance: async <A>(
      request: ExclusiveMaintenanceRequest,
      operation: () => Promise<A>,
    ) => {
      fence = request.targetKey;
      entered.resolve();
      await release.promise;
      return operation();
    },
  };
  const controls = copyOptions({
    ...options,
    workerEntrypoint: "worker.ts",
    sqlite: {
      ...options.sqlite,
      extensionPath: "native/vector.so",
      customSQLite: "native/sqlite.so",
    },
  });
  const pathControl =
    controls.authorizedDirectory === path.join(a, "cache") &&
    controls.sourceRoot === path.join(a, "sources") &&
    controls.workerEntrypoint === path.join(a, "worker.ts") &&
    controls.sqlite.path === path.join(a, "cache/cache.sqlite") &&
    controls.sqlite.extensionPath === path.join(a, "native/vector.so") &&
    controls.sqlite.customSQLite === path.join(a, "native/sqlite.so") &&
    controls.relativeTarget === "cache.sqlite";
  const controller = createCacheRecoveryController(options);
  let running: ReturnType<typeof controller.recover> | undefined;
  try {
    running = controller.recover();
    await entered.promise;
    process.chdir(b);
    if (mode === "caller-mutation") {
      options.authorizedDirectory = path.join(b, "cache");
      options.sourceRoot = path.join(b, "sources");
      options.workerEntrypoint = path.join(b, "worker.ts");
      options.sqlite.path = path.join(b, "cache/cache.sqlite");
      options.search.maxTopN = 1;
    }
    release.resolve();
    const result = await running;
    const expectedFence = createHash("sha256")
      .update(JSON.stringify([path.join(a, "cache"), "cache.sqlite"]))
      .digest("hex");
    const backup =
      result.actionId === undefined
        ? undefined
        : path.join(
            a,
            "cache/.object-mcp-cache-recovery",
            expectedFence,
            "backups",
            `${result.actionId}.old.sqlite`,
          );
    let exactBackup = false;
    if (backup) {
      try {
        exactBackup = (await readFile(backup)).equals(aBytes);
      } catch {
        exactBackup = false;
      }
    }
    return {
      status: result.status,
      aProjection: projection(path.join(a, "cache/cache.sqlite"), "from-a"),
      aChanged: !(await readFile(path.join(a, "cache/cache.sqlite"))).equals(aBytes),
      bUnchanged: (await readFile(path.join(b, "cache/cache.sqlite"))).equals(bBytes),
      bInventoryUnchanged: JSON.stringify(await inventory(b)) === JSON.stringify(bInventory),
      sourcesUnchanged:
        (await readFile(aSource)).equals(aSourceBytes) &&
        (await readFile(bSource)).equals(bSourceBytes),
      exactBackup,
      fenceMatchesA: fence === expectedFence,
      pathControl,
      callerUnfrozen:
        !Object.isFrozen(options) &&
        !Object.isFrozen(options.sqlite) &&
        !Object.isFrozen(options.search),
    };
  } finally {
    release.resolve();
    if (running) await running;
    await controller.close();
  }
}

if (import.meta.main) {
  const root = process.argv[2];
  const mode = process.argv[3];
  if (!root || !mode) throw new Error("FIXTURE_ARGUMENTS");
  try {
    process.stdout.write(JSON.stringify(await scenario(root, mode)));
  } catch {
    process.stdout.write(JSON.stringify({ status: "fixture-failed" }));
    process.exitCode = 1;
  }
}
