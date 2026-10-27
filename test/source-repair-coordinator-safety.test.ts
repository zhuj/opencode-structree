import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSourceRepairSession } from "../src/lib/source-repair/index.ts";
import { SqliteProcessLock } from "../src/lib/sqlite/process-lock.ts";

describe("source repair coordinator path safety", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "object-mcp-repair-coordinator-"));
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  test("rejects coordinator symlinks before loading native locks for both drivers", async () => {
    for (const driver of ["bun", "better-sqlite3"] as const) {
      const fixtureRoot = path.join(root, driver);
      await mkdir(fixtureRoot);
      const externalDatabase = path.join(root, `${driver}-external.sqlite`);
      const initialized = await SqliteProcessLock.open({ path: externalDatabase, driver });
      await initialized.close();
      const externalBytes = await readFile(externalDatabase);
      const originalSource = Buffer.from([0xff, 0x0a]);
      await writeFile(path.join(fixtureRoot, "damaged.md"), originalSource);
      await symlink(externalDatabase, path.join(fixtureRoot, ".object-mcp-lock.sqlite"));

      expect(runRepairWithCoordinatorFault(fixtureRoot, driver).status).toBe(0);
      expect(await readFile(externalDatabase)).toEqual(externalBytes);
      expect(await readFile(path.join(fixtureRoot, "damaged.md"))).toEqual(originalSource);
    }
  });

  test("rejects a nonregular coordinator target before loading SQLite", async () => {
    const fixtureRoot = path.join(root, "directory-coordinator");
    await mkdir(fixtureRoot);
    await mkdir(path.join(fixtureRoot, ".object-mcp-lock.sqlite"));
    const originalSource = Buffer.from([0xff]);
    await writeFile(path.join(fixtureRoot, "damaged.md"), originalSource);

    expect(runRepairWithCoordinatorFault(fixtureRoot, "bun").status).toBe(0);
    expect(await readFile(path.join(fixtureRoot, "damaged.md"))).toEqual(originalSource);
  });

  test("allows approved writes to create a missing coordinator for either driver", async () => {
    for (const driver of ["bun", "better-sqlite3"] as const) {
      const fixtureRoot = path.join(root, `missing-${driver}`);
      await mkdir(fixtureRoot);
      await writeFile(path.join(fixtureRoot, "source.md"), "before");
      const session = await createSourceRepairSession({ root: fixtureRoot, driver });
      try {
        const plan = await session.planReplacement({
          sourcePath: "source.md",
          payload: Buffer.from("after"),
        });
        await session.apply(plan, { approved: true });
        expect(await readFile(path.join(fixtureRoot, "source.md"), "utf8")).toBe("after");
        expect(
          (await readFile(path.join(fixtureRoot, ".object-mcp-lock.sqlite"))).byteLength,
        ).toBeGreaterThan(0);
      } finally {
        await session.close();
      }
    }
  });

  test("rejects the exact recovery namespace as a replacement source before writer creation", async () => {
    await writeFile(path.join(root, ".object-mcp-recovery"), "before");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: ".object-mcp-recovery",
        payload: Buffer.from("after"),
      });
      await expect(session.apply(plan, { approved: true })).rejects.toMatchObject({
        code: "INVALID_PLAN",
      });
      expect(await readFile(path.join(root, ".object-mcp-recovery"), "utf8")).toBe("before");
      await expect(readFile(path.join(root, ".object-mcp-lock.sqlite"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("rejects the exact recovery namespace as a draft target before writer creation", async () => {
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const draft = await session.planDraft({
        sourcePath: ".object-mcp-recovery",
        payload: Buffer.from("occupy namespace"),
      });
      await expect(session.apply(draft, { approved: true })).rejects.toMatchObject({
        code: "INVALID_PLAN",
      });
      await expect(readFile(path.join(root, ".object-mcp-lock.sqlite"))).rejects.toBeDefined();
      await expect(readFile(path.join(root, ".object-mcp-recovery"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("rejects the exact recovery namespace as a salvage destination during planning", async () => {
    await writeFile(path.join(root, "damaged.md"), Buffer.from([0xff]));
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      await expect(
        session.planSalvage({
          sourcePath: "damaged.md",
          destinationPath: ".object-mcp-recovery",
        }),
      ).rejects.toMatchObject({ code: "INVALID_PLAN" });
      await expect(readFile(path.join(root, ".object-mcp-lock.sqlite"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("does not allow an internal backup path as a salvage destination", async () => {
    await writeFile(path.join(root, "damaged.md"), Buffer.from([0xff]));
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      await expect(
        session.planSalvage({
          sourcePath: "damaged.md",
          destinationPath: `.object-mcp-recovery/backups/${"a".repeat(64)}.bak`,
        }),
      ).rejects.toMatchObject({ code: "INVALID_PLAN" });
      await expect(readFile(path.join(root, ".object-mcp-lock.sqlite"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });
});

function runRepairWithCoordinatorFault(root: string, driver: "bun" | "better-sqlite3") {
  const coordinatorModule = path.resolve("src/lib/sqlite/process-lock.ts");
  const sourceRepairModule = path.resolve("src/lib/source-repair/index.ts");
  const script = `
    import { mock } from "bun:test";
    let coordinatorImported = false;
    mock.module(${JSON.stringify(coordinatorModule)}, () => {
      coordinatorImported = true;
      throw new Error("Coordinator module must not load before the path guard");
    });
    const { createSourceRepairSession } = await import(${JSON.stringify(sourceRepairModule)});
    const root = process.env.SOURCE_REPAIR_TEST_ROOT;
    const driver = process.env.SOURCE_REPAIR_TEST_DRIVER;
    const session = await createSourceRepairSession({ root, driver });
    try {
      const plan = await session.planReplacement({ sourcePath: "damaged.md", payload: Buffer.from([254]) });
      let error;
      try {
        await session.apply(plan, { approved: true });
      } catch (failure) {
        error = failure;
      }
      if (error?.code !== "COORDINATION_UNSAFE") throw new Error("Unsafe coordinator was not rejected");
      if (coordinatorImported) throw new Error("Native coordinator module loaded before rejection");
    } finally {
      await session.close();
    }
  `;
  return spawnSync("bun", ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SOURCE_REPAIR_TEST_DRIVER: driver,
      SOURCE_REPAIR_TEST_ROOT: root,
    },
  });
}
