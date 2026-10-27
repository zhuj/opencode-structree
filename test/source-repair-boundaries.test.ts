import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSourceRepairSession } from "../src/lib/source-repair/index.ts";
import { ConfinedFilesystem } from "../src/lib/vault/confined-filesystem.ts";

describe("source repair call boundaries", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "object-mcp-repair-boundary-"));
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  test("snapshots false apply approval before caller mutation and before writer creation", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("after"),
      });
      const approval = { approved: false };
      const operation = session.apply(plan, approval);
      approval.approved = true;
      await expect(operation).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
      expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("before");
      await expect(readFile(path.join(root, ".object-mcp-lock.sqlite"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("snapshots the configured root before session initialization awaits", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    const options = { root, driver: "bun" as const };
    const opening = createSourceRepairSession(options);
    options.root = path.join(root, "redirected-root");
    const session = await opening;
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("after"),
      });
      expect(plan.sourcePath).toBe("source.md");
    } finally {
      await session.close();
    }
  });

  test("snapshots a salvage plan before its caller can redirect the destination", async () => {
    await writeFile(path.join(root, "damaged.md"), Buffer.from([0xff, 0x0a]));
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const planned = await session.planSalvage({
        sourcePath: "damaged.md",
        destinationPath: "approved.md",
      });
      const callerPlan = { ...planned };
      const operation = session.apply(callerPlan, { approved: true });
      callerPlan.destinationPath = "redirected.md";
      await operation;
      expect(await readFile(path.join(root, "approved.md"))).toEqual(Buffer.from([0xff, 0x0a]));
      await expect(readFile(path.join(root, "redirected.md"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("rejects a destination-tampered salvage plan before initializing the writer", async () => {
    await writeFile(path.join(root, "damaged.md"), "raw");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planSalvage({
        sourcePath: "damaged.md",
        destinationPath: "approved.md",
      });
      await expect(
        session.apply({ ...plan, destinationPath: "tampered.md" }, { approved: true }),
      ).rejects.toMatchObject({ code: "INVALID_PLAN" });
      await expect(readFile(path.join(root, ".object-mcp-lock.sqlite"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("binds distinct salvage destinations to distinct action identifiers", async () => {
    await writeFile(path.join(root, "damaged.md"), "raw");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const first = await session.planSalvage({
        sourcePath: "damaged.md",
        destinationPath: "first.md",
      });
      const second = await session.planSalvage({
        sourcePath: "damaged.md",
        destinationPath: "second.md",
      });
      expect(first.actionId).not.toBe(second.actionId);
    } finally {
      await session.close();
    }
  });

  test("snapshots the approved cancellation signal reference", async () => {
    await writeFile(path.join(root, "damaged.md"), "raw");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planSalvage({
        sourcePath: "damaged.md",
        destinationPath: "copy.md",
      });
      const approvedSignal = new AbortController();
      const replacementSignal = new AbortController();
      replacementSignal.abort();
      const approval = { approved: true, signal: approvedSignal.signal };
      const operation = session.apply(plan, approval);
      approval.signal = replacementSignal.signal;
      await operation;
      expect(await readFile(path.join(root, "copy.md"), "utf8")).toBe("raw");
    } finally {
      await session.close();
    }
  });

  test("snapshots replacement plans at rollback entry", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("after"),
      });
      await session.apply(plan, { approved: true });
      const callerPlan = { ...plan };
      const approval = { approved: false };
      const operation = session.rollbackReplace(callerPlan, approval);
      callerPlan.sourcePath = "redirected.md";
      approval.approved = true;
      await expect(operation).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
      expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("after");
    } finally {
      await session.close();
    }
  });

  test("uses the rollback plan projection captured before caller mutation", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({
        sourcePath: "source.md",
        payload: Buffer.from("after"),
      });
      await session.apply(plan, { approved: true });
      const callerPlan = { ...plan };
      const operation = session.rollbackReplace(callerPlan, { approved: true });
      callerPlan.sourcePath = "redirected.md";
      await operation;
      expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("before");
      await expect(readFile(path.join(root, "redirected.md"))).rejects.toBeDefined();
    } finally {
      await session.close();
    }
  });

  test("passes the session lifetime signal into plan reads and aborts it on close", async () => {
    await writeFile(path.join(root, "source.md"), "before");
    let observedSignal: AbortSignal | undefined;
    const originalRead = ConfinedFilesystem.prototype.readBytes;
    const readSpy = spyOn(ConfinedFilesystem.prototype, "readBytes").mockImplementation(function (
      this: ConfinedFilesystem,
      relative: string,
      signal?: AbortSignal,
    ) {
      observedSignal = signal;
      return originalRead.call(this, relative, signal);
    });
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      await session.planReplacement({ sourcePath: "source.md", payload: Buffer.from("after") });
      await session.close();
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      readSpy.mockRestore();
      await session.close();
    }
  });
});
