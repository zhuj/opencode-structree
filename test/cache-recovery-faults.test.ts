import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCacheRecoveryController } from "../src/lib/cache-recovery/controller.ts";
import { withRecoveryFaultForTest } from "../src/lib/cache-recovery/faults.ts";
import {
  controllerOptions,
  makeCacheRecoveryFixture,
  writeProject,
} from "./cache-recovery-fixture.ts";

for (const changed of ["source", "target"] as const) {
  it(`refuses publication after the ${changed} changes during the job`, async () => {
    const fixture = await makeCacheRecoveryFixture();
    const controller = createCacheRecoveryController(
      controllerOptions(fixture, "bun", async (_request, operation) => operation()),
    );
    try {
      const file = await writeProject(fixture.sourceRoot, "first", "originalword");
      const old = await readFile(fixture.target);
      const later = Buffer.from("changed target bytes");
      const result = await withRecoveryFaultForTest(
        async (checkpoint) => {
          if (checkpoint === "candidate-verified") {
            if (changed === "source") await writeFile(file, "later partial source");
            else await writeFile(fixture.target, later);
          }
        },
        () => controller.recover(),
      );
      expect(result.status).not.toBe("recovered");
      expect(await readFile(fixture.target)).toEqual(changed === "target" ? later : old);
    } finally {
      try {
        await controller.close();
      } finally {
        await fixture.cleanup();
      }
    }
  });
}

it("retains old and failed candidate bytes when postpublication verification fails", async () => {
  const fixture = await makeCacheRecoveryFixture();
  const controller = createCacheRecoveryController(
    controllerOptions(fixture, "bun", async (_request, operation) => operation()),
  );
  try {
    await writeProject(fixture.sourceRoot, "first", "originalword");
    const old = await readFile(fixture.target);
    const result = await withRecoveryFaultForTest(
      async (checkpoint) => {
        if (checkpoint === "after-publish") throw new Error("private fault must stay private");
      },
      () => controller.recover(),
    );
    expect(result).toMatchObject({ status: "failed", code: "POSTCHECK_ROLLED_BACK" });
    expect(await readFile(fixture.target)).toEqual(old);
    expect(JSON.stringify(result)).not.toContain("private fault");
    const key = createHash("sha256")
      .update(JSON.stringify([fixture.cacheRoot, "cache.sqlite"]))
      .digest("hex");
    const work = path.join(fixture.cacheRoot, ".object-mcp-cache-recovery", key);
    const backups = await readdir(path.join(work, "backups"));
    const candidates = await readdir(path.join(work, "candidates"));
    expect(backups.length).toBe(1);
    expect(candidates.length).toBe(1);
    const backup = backups[0];
    const candidate = candidates[0];
    if (!backup || !candidate) throw new Error("Expected retained artifacts.");
    expect(await readFile(path.join(work, "backups", backup))).toEqual(old);
    expect(await readFile(path.join(work, "candidates", candidate))).not.toEqual(old);
  } finally {
    try {
      await controller.close();
    } finally {
      await fixture.cleanup();
    }
  }
});

it("never rolls back over a later target write and retains an ambiguous publication receipt", async () => {
  const fixture = await makeCacheRecoveryFixture();
  const controller = createCacheRecoveryController(
    controllerOptions(fixture, "bun", async (_request, operation) => operation()),
  );
  try {
    await writeProject(fixture.sourceRoot, "first", "originalword");
    const later = Buffer.from("later target replacement");
    const result = await withRecoveryFaultForTest(
      async (checkpoint) => {
        if (checkpoint === "after-publish") await writeFile(fixture.target, later);
      },
      () => controller.recover(),
    );
    expect(result).toMatchObject({ status: "blocked", code: "MANUAL_INSPECTION" });
    expect(await readFile(fixture.target)).toEqual(later);
    expect(await controller.recover()).toMatchObject({
      status: "blocked",
      code: "MANUAL_INSPECTION",
    });
  } finally {
    try {
      await controller.close();
    } finally {
      await fixture.cleanup();
    }
  }
});

it("refuses a conflicting old-backup artifact without overwriting target or existing artifact", async () => {
  const fixture = await makeCacheRecoveryFixture();
  const controller = createCacheRecoveryController(
    controllerOptions(fixture, "bun", async (_request, operation) => operation()),
  );
  try {
    await writeProject(fixture.sourceRoot, "first", "originalword");
    const old = await readFile(fixture.target);
    const key = createHash("sha256")
      .update(JSON.stringify([fixture.cacheRoot, "cache.sqlite"]))
      .digest("hex");
    const work = path.join(fixture.cacheRoot, ".object-mcp-cache-recovery", key);
    let artifact: string | undefined;
    const result = await withRecoveryFaultForTest(
      async (checkpoint) => {
        if (checkpoint !== "before-backup") return;
        const receipt = (await readdir(path.join(work, "receipts")))[0];
        if (!receipt) throw new Error("Expected durable prebuild receipt.");
        artifact = path.join(work, "backups", `${receipt.slice(0, 64)}.old.sqlite`);
        await writeFile(artifact, "existing foreign artifact", { flag: "wx" });
      },
      () => controller.recover(),
    );
    expect(result).toMatchObject({ status: "failed", code: "BACKUP_FAILED" });
    expect(await readFile(fixture.target)).toEqual(old);
    if (!artifact) throw new Error("Expected conflict artifact.");
    expect(await readFile(artifact, "utf8")).toBe("existing foreign artifact");
  } finally {
    try {
      await controller.close();
    } finally {
      await fixture.cleanup();
    }
  }
});
