import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCacheRecoveryController } from "../src/lib/cache-recovery/controller.ts";
import {
  controllerOptions,
  makeCacheRecoveryFixture,
  writeProject,
} from "./cache-recovery-fixture.ts";

it("keeps a crash receipt fenced across controller restart", async () => {
  const fixture = await makeCacheRecoveryFixture();
  const options = controllerOptions(fixture, "bun", async (_request, operation) => operation());
  const controller = createCacheRecoveryController(options);
  let restarted: ReturnType<typeof createCacheRecoveryController> | undefined;
  try {
    const result = await controller.recover();
    expect(result.status).toBe("recovered");
    if (!result.actionId) throw new Error("Expected retained action.");
    const key = createHash("sha256")
      .update(JSON.stringify([fixture.cacheRoot, "cache.sqlite"]))
      .digest("hex");
    const file = path.join(
      fixture.cacheRoot,
      ".object-mcp-cache-recovery",
      key,
      "receipts",
      `${result.actionId}.json`,
    );
    const receipt: unknown = JSON.parse(await readFile(file, "utf8"));
    if (typeof receipt !== "object" || receipt === null) throw new Error("Expected receipt.");
    await writeFile(file, JSON.stringify({ ...receipt, phase: "publishing" }));
    const before = await readFile(fixture.target);
    await controller.close();
    restarted = createCacheRecoveryController(options);
    expect(await restarted.recover()).toMatchObject({
      status: "blocked",
      code: "MANUAL_INSPECTION",
    });
    expect(await readFile(fixture.target)).toEqual(before);
  } finally {
    try {
      await controller.close();
      await restarted?.close();
    } finally {
      await fixture.cleanup();
    }
  }
});

it("persists target cooldown when source revisions change immediately after a successful job", async () => {
  const fixture = await makeCacheRecoveryFixture();
  const options = controllerOptions(fixture, "bun", async (_request, operation) => operation());
  const controller = createCacheRecoveryController(options);
  let restarted: ReturnType<typeof createCacheRecoveryController> | undefined;
  try {
    expect((await controller.recover()).status).toBe("recovered");
    const before = await readFile(fixture.target);
    await controller.close();
    await writeProject(fixture.sourceRoot, "later", "laterrevision");
    restarted = createCacheRecoveryController(options);
    expect(await restarted.recover()).toMatchObject({ status: "blocked", code: "TARGET_COOLDOWN" });
    expect(await readFile(fixture.target)).toEqual(before);
    expect((await readdir(fixture.cacheRoot)).includes("cache.sqlite")).toBe(true);
  } finally {
    try {
      await controller.close();
      await restarted?.close();
    } finally {
      await fixture.cleanup();
    }
  }
});
