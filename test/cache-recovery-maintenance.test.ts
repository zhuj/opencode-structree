import { expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { createCacheRecoveryController } from "../src/lib/cache-recovery/controller.ts";
import type { CacheRecoveryOutcome } from "../src/lib/cache-recovery/controller-types.ts";
import { controllerOptions, makeCacheRecoveryFixture } from "./cache-recovery-fixture.ts";

it("does not trust a callback result or a saved late operation as publication evidence", async () => {
  const fixture = await makeCacheRecoveryFixture();
  let late: (() => Promise<unknown>) | undefined;
  const controller = createCacheRecoveryController({
    ...controllerOptions(fixture, "bun"),
    withExclusiveCacheMaintenance: async (_request, operation) => {
      late = operation;
      throw new Error("host did not acquire maintenance");
    },
  });
  try {
    const before = await readFile(fixture.target);
    expect(await controller.recover()).toMatchObject({
      status: "blocked",
      code: "MAINTENANCE_PROTOCOL",
    });
    if (!late) throw new Error("Expected saved operation.");
    expect(await late()).toMatchObject({ status: "blocked", code: "MAINTENANCE_PROTOCOL" });
    expect(await readFile(fixture.target)).toEqual(before);
    expect(await readdir(fixture.cacheRoot)).toEqual(["cache.sqlite"]);
  } finally {
    try {
      await controller.close();
    } finally {
      await fixture.cleanup();
    }
  }
});

it("coalesces separate controllers for the same fixed target while the first owns maintenance", async () => {
  const fixture = await makeCacheRecoveryFixture();
  const gate = Promise.withResolvers<void>();
  let owners = 0;
  const options = controllerOptions(fixture, "bun", async (_request, operation) => {
    owners++;
    await gate.promise;
    return operation();
  });
  const first = createCacheRecoveryController(options);
  const second = createCacheRecoveryController(options);
  try {
    const left = first.recover();
    const right = second.recover();
    expect(owners).toBe(1);
    gate.resolve();
    const results: CacheRecoveryOutcome[] = await Promise.all([left, right]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]?.status).toBe("recovered");
    expect(owners).toBe(1);
  } finally {
    gate.resolve();
    try {
      await first.close();
      await second.close();
    } finally {
      await fixture.cleanup();
    }
  }
});
