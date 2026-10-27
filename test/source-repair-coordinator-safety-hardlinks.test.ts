import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSourceRepairSession } from "../src/lib/source-repair/index.ts";
import { SqliteProcessLock } from "../src/lib/sqlite/process-lock.ts";

describe("source repair coordinator hardlink safety", () => {
  let directory: string;
  let root: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "object-mcp-coordinator-hardlink-"));
    root = path.join(directory, "sources");
    await mkdir(root);
    await writeFile(path.join(root, "source.md"), "before");
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  for (const driver of ["bun", "better-sqlite3"] as const) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      test(`${driver} rejects a multiply linked coordinator${suffix} without modifying either source`, async () => {
        const externalPath = path.join(directory, "external.sqlite");
        const database = new Database(externalPath);
        try {
          database.exec(
            "CREATE TABLE external_sentinel (value TEXT); INSERT INTO external_sentinel VALUES ('untouched');",
          );
        } finally {
          database.close();
        }
        const externalBefore = await readFile(externalPath);
        await link(externalPath, path.join(root, `.object-mcp-lock.sqlite${suffix}`));
        const session = await createSourceRepairSession({ root, driver });
        try {
          const plan = await session.planReplacement({
            sourcePath: "source.md",
            payload: Buffer.from("after"),
          });
          await expect(session.apply(plan, { approved: true })).rejects.toMatchObject({
            code: "COORDINATION_UNSAFE",
          });
          expect(await readFile(externalPath)).toEqual(externalBefore);
          expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("before");
        } finally {
          await session.close();
        }
      });
    }

    test(`${driver} accepts an existing single-link coordinator`, async () => {
      const coordinator = await SqliteProcessLock.open({
        path: path.join(root, ".object-mcp-lock.sqlite"),
        driver,
      });
      await coordinator.close();
      const session = await createSourceRepairSession({ root, driver });
      try {
        const plan = await session.planReplacement({
          sourcePath: "source.md",
          payload: Buffer.from("after"),
        });
        expect((await session.apply(plan, { approved: true })).state).toBe("committed");
        expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("after");
      } finally {
        await session.close();
      }
    });
  }
});
