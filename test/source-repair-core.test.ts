import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSourceRepairSession } from "../src/lib/source-repair/index.ts";
import { SqliteProcessLock } from "../src/lib/sqlite/process-lock.ts";

describe("source repair core", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "object-mcp-source-repair-"));
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  test("plans exact byte replacements and requires explicit approval", async () => {
    await writeFile(path.join(root, "broken.md"), Buffer.from([0xff, 0x0a]));
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "broken.md",
        payload: Uint8Array.from([0xfe, 0x0a]),
      });
      expect(
        await readFile(path.join(root, ".object-mcp-lock.sqlite")).catch(() => undefined),
      ).toBeUndefined();
      expect(await readFile(path.join(root, "broken.md"))).toEqual(Buffer.from([0xff, 0x0a]));
      await expect(session.apply(plan, { approved: false })).rejects.toMatchObject({
        code: "APPROVAL_REQUIRED",
      });
      expect(await readFile(path.join(root, "broken.md"))).toEqual(Buffer.from([0xff, 0x0a]));
      expect((await session.apply(plan, { approved: true })).sourceCommitted).toBe(true);
      expect(await readFile(path.join(root, "broken.md"))).toEqual(Buffer.from([0xfe, 0x0a]));
      expect(await readFile(path.join(root, plan.backupPath))).toEqual(Buffer.from([0xff, 0x0a]));
    } finally {
      await session.close();
    }
  });

  test("patches original byte offsets and snapshots caller-owned insertion buffers", async () => {
    const original = Buffer.from([0xff, 0x0a, 0x41, 0x42]);
    await writeFile(path.join(root, "raw.md"), original);
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const insert = Uint8Array.from([0xfe]);
      const planPromise = session.planPatch({
        sourcePath: "raw.md",
        edits: [{ offset: 2, deleteBytes: 1, insert }],
      });
      insert[0] = 0;
      const plan = await planPromise;
      await session.apply(plan, { approved: true });
      expect(await readFile(path.join(root, "raw.md"))).toEqual(
        Buffer.from([0xff, 0x0a, 0xfe, 0x42]),
      );
    } finally {
      await session.close();
    }
  });

  test("refuses a pre-existing mismatched backup before publishing a replacement", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("after"),
      });
      await mkdir(path.dirname(path.join(root, plan.backupPath)), { recursive: true });
      await writeFile(path.join(root, plan.backupPath), "not the original");
      await expect(session.apply(plan, { approved: true })).rejects.toMatchObject({
        code: "BACKUP_CONFLICT",
      });
      expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("before");
    } finally {
      await session.close();
    }
  });

  test("does not follow a symlink source outside the confined root", async () => {
    const outside = path.join(root, "outside.md");
    await writeFile(outside, "outside");
    await symlink(outside, path.join(root, "linked.md"));
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      await expect(
        session.planReplacement({ sourcePath: "linked.md", payload: Buffer.from("changed") }),
      ).rejects.toMatchObject({ message: "Repair operation was blocked by the source boundary." });
      expect(await readFile(outside, "utf8")).toBe("outside");
    } finally {
      await session.close();
    }
  });

  test("rejects stale plans and tampered serialized payloads without changing files", async () => {
    await writeFile(path.join(root, "source.md"), "first");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("fixed"),
      });
      await writeFile(path.join(root, "source.md"), "later");
      await expect(session.apply(plan, { approved: true })).rejects.toMatchObject({
        code: "SOURCE_CONFLICT",
      });
      await expect(
        session.apply(
          { ...plan, payload: Buffer.from("evil").toString("base64") },
          { approved: true },
        ),
      ).rejects.toMatchObject({ code: "INVALID_PLAN" });
      expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("later");
    } finally {
      await session.close();
    }
  });

  test("creates drafts exclusively and salvages exact bytes without changing the source", async () => {
    const raw = Buffer.from([0x23, 0xff, 0x0a]);
    await writeFile(path.join(root, "partial.md"), raw);
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const draft = await session.planDraft({ sourcePath: "draft.md", payload: raw });
      await session.apply(draft, { approved: true });
      expect((await session.apply(draft, { approved: true })).state).toBe("already-applied");
      const salvage = await session.planSalvage({
        sourcePath: "partial.md",
        destinationPath: "recovered.md",
      });
      await session.apply(salvage, { approved: true });
      expect((await session.apply(salvage, { approved: true })).state).toBe("already-applied");
      expect(await readFile(path.join(root, "partial.md"))).toEqual(raw);
      expect(await readFile(path.join(root, "recovered.md"))).toEqual(raw);
    } finally {
      await session.close();
    }
  });

  test("rolls back only the approved replacement revision and refuses later edits", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("after"),
      });
      await session.apply(plan, { approved: true });
      expect((await session.rollbackReplace(plan, { approved: true })).state).toBe("committed");
      expect((await session.rollbackReplace(plan, { approved: true })).state).toBe(
        "already-applied",
      );
      await writeFile(path.join(root, "source.md"), "later");
      await expect(session.rollbackReplace(plan, { approved: true })).rejects.toMatchObject({
        code: "SOURCE_CONFLICT",
      });
    } finally {
      await session.close();
    }
  });

  test("does not create a missing root during session construction", async () => {
    const missing = path.join(root, "missing");
    await expect(createSourceRepairSession({ root: missing, driver: "bun" })).rejects.toBeDefined();
    await expect(readFile(missing)).rejects.toBeDefined();
  });

  test("an already-cancelled approved operation does not initialize its writer", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("after"),
      });
      const controller = new AbortController();
      controller.abort();
      await expect(
        session.apply(plan, { approved: true, signal: controller.signal }),
      ).rejects.toMatchObject({ code: "ABORTED" });
      expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("before");
      await expect(readFile(path.join(root, ".object-mcp-lock.sqlite"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("honors the existing SQLite process lock for either configured driver", async () => {
    for (const driver of ["bun", "better-sqlite3"] as const) {
      await mkdir(path.join(root, driver), { recursive: true });
      const fixtureRoot = path.join(root, driver);
      await writeFile(path.join(fixtureRoot, "source.md"), "before");
      const blocker = await SqliteProcessLock.open({
        path: path.join(fixtureRoot, ".object-mcp-lock.sqlite"),
        driver,
      });
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const lockWork = blocker.run(async () => {
        entered();
        await held;
      });
      await started;
      const session = await createSourceRepairSession({
        root: fixtureRoot,
        driver,
        lockTimeoutMs: 20,
      });
      try {
        const plan = await session.planReplacement({
          sourcePath: "source.md",
          payload: Buffer.from("after"),
        });
        await expect(session.apply(plan, { approved: true })).rejects.toMatchObject({
          code: "LOCK_TIMEOUT",
        });
        expect(await readFile(path.join(fixtureRoot, "source.md"), "utf8")).toBe("before");
      } finally {
        await session.close();
        release();
        await lockWork;
        await blocker.close();
      }
    }
  });
});
