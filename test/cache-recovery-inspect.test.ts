import { afterEach, describe, expect, it } from "bun:test";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  inspectClosedCache,
  withNativeInspectionHookForTest,
} from "../src/lib/cache-recovery/inspect.ts";
import { withPreparedFileCloseHookForTest } from "../src/lib/cache-recovery/inspect-file.ts";
import { CacheDatabase } from "../src/lib/sqlite/cache-database.ts";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), "cache-recovery-inspect-"));
  try {
    const root = await realpath(scratch);
    roots.push(root);
    return root;
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createCache(file: string, driver: "bun" | "better-sqlite3" = "bun"): Promise<void> {
  const cache = new CacheDatabase({ path: file, driver, busyTimeoutMs: 0 });
  try {
    cache.raw.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
  } finally {
    cache.close();
  }
}

describe("inspectClosedCache", () => {
  for (const driver of ["bun", "better-sqlite3"] as const) {
    it(`admits a closed, checkpointed ${driver} cache without changing it`, async () => {
      const root = await fixture();
      const filename = "cache.sqlite";
      const file = path.join(root, filename);
      await createCache(file, driver);
      const before = await readFile(file);
      const listedBefore = await readdir(root);

      const result = await inspectClosedCache({
        authorizedDirectory: root,
        relativeFilename: filename,
      });

      expect(result.status).toBe("accepted");
      if (result.status === "accepted") {
        expect(result.applicationId).toBe(1330463568);
        expect(result.schemaVersion).toBe(3);
        expect(result.byteLength).toBe(before.byteLength);
        expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(result.objectCount).toBe(0);
        expect(result.embeddingCount).toBe(0);
      }
      expect(await readFile(file)).toEqual(before);
      expect(await readdir(root)).toEqual(listedBefore);
    });
  }

  it("rejects WAL sidecars before immutable inspection and leaves them untouched", async () => {
    const root = await fixture();
    const file = path.join(root, "cache.sqlite");
    await createCache(file);
    const sidecar = `${file}-wal`;
    await writeFile(sidecar, "preserve");
    const before = await readFile(file);

    const result = await inspectClosedCache({
      authorizedDirectory: root,
      relativeFilename: "cache.sqlite",
    });

    expect(result).toMatchObject({ status: "blocked", code: "SIDECAR_PRESENT" });
    expect(await readFile(file)).toEqual(before);
    expect(await readFile(sidecar, "utf8")).toBe("preserve");
  });

  it("rejects journal and shared-memory sidecars", async () => {
    for (const suffix of ["-journal", "-shm"]) {
      const root = await fixture();
      const file = path.join(root, "cache.sqlite");
      await createCache(file);
      await writeFile(`${file}${suffix}`, "preserve");
      expect(
        await inspectClosedCache({ authorizedDirectory: root, relativeFilename: "cache.sqlite" }),
      ).toMatchObject({ status: "blocked", code: "SIDECAR_PRESENT" });
      expect(await readFile(`${file}${suffix}`, "utf8")).toBe("preserve");
    }
  });

  it("does not create a missing target", async () => {
    const root = await fixture();
    const result = await inspectClosedCache({
      authorizedDirectory: root,
      relativeFilename: "missing.sqlite",
    });
    expect(result).toMatchObject({ status: "blocked", code: "TARGET_MISSING" });
    expect(await readdir(root)).toEqual([]);
  });

  it("blocks a missing root and traversal through an unsafe ancestor", async () => {
    const root = await fixture();
    const missing = path.join(root, "absent");
    expect(
      await inspectClosedCache({ authorizedDirectory: missing, relativeFilename: "cache.sqlite" }),
    ).toMatchObject({ status: "blocked", code: "UNSAFE_PATH" });
    await symlink(root, path.join(root, "alias"));
    expect(
      await inspectClosedCache({
        authorizedDirectory: root,
        relativeFilename: "alias/cache.sqlite",
      }),
    ).toMatchObject({ status: "blocked", code: "UNSAFE_PATH" });
    expect(await readdir(root)).toEqual(["alias"]);
  });

  it("rejects wrong ownership and schema headers", async () => {
    const { Database } = await import("bun:sqlite");
    for (const [filename, pragma] of [
      ["wrong-owner.sqlite", "PRAGMA application_id=7; PRAGMA user_version=3;"],
      ["wrong-version.sqlite", "PRAGMA application_id=1330463568; PRAGMA user_version=2;"],
    ] as const) {
      const root = await fixture();
      const file = path.join(root, filename);
      await createCache(file);
      const db = new Database(file, { create: false });
      db.exec(pragma);
      db.close();
      let nativeCalls = 0;
      const result = await withNativeInspectionHookForTest(
        async () => {
          nativeCalls++;
          throw new Error("native inspection should not run");
        },
        () => inspectClosedCache({ authorizedDirectory: root, relativeFilename: filename }),
      );
      expect(result).toMatchObject({ status: "blocked", code: "OWNERSHIP_MISMATCH" });
      expect(nativeCalls).toBe(0);
    }
  });

  it("rejects invalid SQLite bytes without modifying them", async () => {
    const root = await fixture();
    const file = path.join(root, "invalid.sqlite");
    const bytes = Buffer.from("not sqlite");
    await writeFile(file, bytes);
    expect(
      await inspectClosedCache({ authorizedDirectory: root, relativeFilename: "invalid.sqlite" }),
    ).toMatchObject({ status: "blocked", code: "INVALID_HEADER" });
    expect(await readFile(file)).toEqual(bytes);
  });

  it("rejects invalid headers before invoking native inspection", async () => {
    const root = await fixture();
    const file = path.join(root, "cache.sqlite");
    await createCache(file);
    const bytes = await readFile(file);
    bytes[0] = 0;
    await writeFile(file, bytes);
    let nativeCalls = 0;

    const result = await withNativeInspectionHookForTest(
      async () => {
        nativeCalls++;
        throw new Error("/private/path must not escape");
      },
      () => inspectClosedCache({ authorizedDirectory: root, relativeFilename: "cache.sqlite" }),
    );

    expect(result).toMatchObject({ status: "blocked", code: "INVALID_HEADER" });
    expect(nativeCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain("/private/path");
    expect(await readFile(file)).toEqual(bytes);
  });

  it("turns an owned file-handle close failure into a fixed blocked outcome", async () => {
    const root = await fixture();
    const file = path.join(root, "cache.sqlite");
    await createCache(file);
    let closeAttempts = 0;

    const result = await withPreparedFileCloseHookForTest(
      async (handle) => {
        closeAttempts++;
        await handle.close();
        throw new Error("/private/cache.sqlite close fault");
      },
      () => inspectClosedCache({ authorizedDirectory: root, relativeFilename: "cache.sqlite" }),
    );

    expect(result).toMatchObject({ status: "blocked", code: "IO_BLOCKED" });
    expect(closeAttempts).toBe(1);
    expect(JSON.stringify(result)).not.toContain("/private/cache.sqlite");
  });

  it("rejects symlink, hard-link, coordination and non-cache paths", async () => {
    const root = await fixture();
    const original = path.join(root, "cache.sqlite");
    await createCache(original);
    await symlink(original, path.join(root, "alias.sqlite"));
    await link(original, path.join(root, "hard.sqlite"));
    await symlink(root, path.join(root, "nested-alias"));
    await mkdir(path.join(root, "directory.sqlite"));
    for (const [relativeFilename, code] of [
      ["alias.sqlite", "UNSAFE_TARGET"],
      ["hard.sqlite", "UNSAFE_TARGET"],
      ["directory.sqlite", "UNSAFE_TARGET"],
      ["nested-alias/cache.sqlite", "UNSAFE_PATH"],
      [".object-mcp-lock.sqlite", "UNSAFE_PATH"],
      ["source.md", "UNSAFE_PATH"],
    ] as const) {
      expect(
        await inspectClosedCache({ authorizedDirectory: root, relativeFilename }),
      ).toMatchObject({ status: "blocked", code });
    }
  });

  it("enforces a lower byte cap and observes cancellation", async () => {
    const root = await fixture();
    const file = path.join(root, "cache.sqlite");
    await createCache(file);
    expect(
      await inspectClosedCache({
        authorizedDirectory: root,
        relativeFilename: "cache.sqlite",
        maxBytes: 64,
      }),
    ).toMatchObject({ status: "blocked", code: "SIZE_LIMIT" });
    const controller = new AbortController();
    controller.abort();
    expect(
      await inspectClosedCache({
        authorizedDirectory: root,
        relativeFilename: "cache.sqlite",
        signal: controller.signal,
      }),
    ).toMatchObject({ status: "blocked", code: "ABORTED" });
  });
});
