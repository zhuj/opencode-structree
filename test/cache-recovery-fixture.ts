import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CacheRecoveryControllerOptions } from "../src/lib/cache-recovery/controller.ts";
import { defaultConfig } from "../src/lib/config.ts";
import { CacheDatabase } from "../src/lib/sqlite/cache-database.ts";

export interface CacheRecoveryFixture {
  readonly root: string;
  readonly cacheRoot: string;
  readonly sourceRoot: string;
  readonly target: string;
  readonly workerEntrypoint: string;
  cleanup(): Promise<void>;
}

const projectDocument = (id: string, marker: string): string =>
  `---\nid: ${id}\nname: ${id} project\ntitle: ${id} project\ndescription: Synthetic fixture.\ncreatedAt: "2025-01-01T00:00:00.000Z"\nupdatedAt: "2025-01-02T00:00:00.000Z"\nretiredAt: null\ntags: {}\nmetadata: {}\nrelations:\n  partOf: null\n---\n\n${marker}\n`;

export async function makeCacheRecoveryFixture(
  driver: "bun" | "better-sqlite3" = "bun",
): Promise<CacheRecoveryFixture> {
  const scratch = await mkdtemp(path.join(tmpdir(), "cache-recovery-fixture-"));
  let root: string;
  try {
    root = await realpath(scratch);
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
  try {
    const cacheRoot = path.join(root, "cache");
    const sourceRoot = path.join(root, "sources");
    await Promise.all([mkdir(cacheRoot), mkdir(sourceRoot)]);
    const target = path.join(cacheRoot, "cache.sqlite");
    const workerEntrypoint = await realpath(
      path.join(process.cwd(), "src/cache-recovery-worker.ts"),
    );
    const fixture: CacheRecoveryFixture = {
      root,
      cacheRoot,
      sourceRoot,
      target,
      workerEntrypoint,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
    const cache = new CacheDatabase({ path: target, driver, busyTimeoutMs: 0 });
    try {
      cache.raw.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    } finally {
      cache.close();
    }
    return fixture;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function writeProject(root: string, id: string, marker: string): Promise<string> {
  const directory = path.join(root, "projects");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${id}.md`);
  await writeFile(file, projectDocument(id, marker));
  return file;
}

export function controllerOptions(
  fixture: CacheRecoveryFixture,
  driver: "bun" | "better-sqlite3",
  maintenance?: CacheRecoveryControllerOptions["withExclusiveCacheMaintenance"],
): CacheRecoveryControllerOptions {
  return {
    enabled: true,
    allowSemanticReset: true,
    authorizedDirectory: fixture.cacheRoot,
    relativeTarget: "cache.sqlite",
    sourceRoot: fixture.sourceRoot,
    workerEntrypoint: fixture.workerEntrypoint,
    sqlite: { ...defaultConfig.sqlite, path: fixture.target, driver, busyTimeoutMs: 0 },
    search: { ...defaultConfig.search },
    ...(maintenance === undefined ? {} : { withExclusiveCacheMaintenance: maintenance }),
  };
}

export async function seedFromProject(
  root: string,
  target: string,
  driver: "bun" | "better-sqlite3",
  withVectors = true,
): Promise<void> {
  const raw = await (await import("node:fs/promises")).readFile(
    path.join(root, "projects", "obsolete.md"),
    "utf8",
  );
  const object = {
    id: "obsolete",
    name: "obsolete project",
    title: "obsolete project",
    description: "Synthetic fixture.",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    retiredAt: null,
    tags: {},
    metadata: {},
    relations: { partOf: null },
  };
  const cache = new CacheDatabase({ path: target, driver, busyTimeoutMs: 0 });
  try {
    const checksum = createHash("sha256").update(raw, "utf8").digest("hex");
    cache.objects.create({
      object_key: "project:obsolete",
      object_type: "project",
      id: "obsolete",
      name: object.name,
      title: object.title,
      path: "projects/obsolete.md",
      checksum,
      json: JSON.stringify(object),
      raw,
      body: raw.split("---\n").slice(-1)[0] ?? "",
      embedding_fingerprint: withVectors ? "synthetic-fixture" : null,
      embedding_checksum: withVectors ? checksum : null,
      embedding_dimensions: withVectors ? 1 : null,
      embedding_chunks: withVectors ? 1 : 0,
    });
    if (withVectors)
      cache.embeddings.create({
        object_key: "project:obsolete",
        chunk_index: 0,
        checksum,
        fingerprint: "synthetic-fixture",
        dimensions: 1,
        start_offset: 0,
        end_offset: Array.from(raw).length,
        chunk_text: raw,
        vector: Buffer.from(new Float32Array([1]).buffer),
      });
    if (cache.embeddings.count() !== (withVectors ? 1 : 0))
      throw new Error("Invalid synthetic embedding fixture.");
    cache.raw.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
  } finally {
    cache.close();
  }
}
