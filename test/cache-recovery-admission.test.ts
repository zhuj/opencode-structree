import { afterEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCacheRecoveryController } from "../src/lib/cache-recovery/controller.ts";
import {
  controllerOptions,
  makeCacheRecoveryFixture,
  writeProject,
} from "./cache-recovery-fixture.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

it("blocks duplicate source identities without publishing a candidate", async () => {
  const fixture = await makeCacheRecoveryFixture("bun");
  roots.push(fixture.root);
  const source = await writeProject(fixture.sourceRoot, "same", "duplicateidentityword");
  await mkdir(path.join(fixture.sourceRoot, "projects", "nested"));
  await writeFile(
    path.join(fixture.sourceRoot, "projects", "nested", "alias.md"),
    await readFile(source),
  );
  const before = await readFile(fixture.target);
  let calls = 0;
  const controller = createCacheRecoveryController(
    controllerOptions(fixture, "bun", async (_request, operation) => {
      calls++;
      return operation();
    }),
  );
  try {
    expect(await controller.recover()).toMatchObject({
      status: "blocked",
      code: "SOURCE_INCOMPLETE",
    });
    expect(calls).toBe(1);
    expect(await readFile(fixture.target)).toEqual(before);
    expect(await readdir(fixture.cacheRoot)).toEqual(["cache.sqlite"]);
  } finally {
    await controller.close();
  }
});

it("blocks a missing target without creating it or a recovery work area", async () => {
  const fixture = await makeCacheRecoveryFixture("bun");
  roots.push(fixture.root);
  await rm(fixture.target);
  const controller = createCacheRecoveryController(
    controllerOptions(fixture, "bun", async (_request, operation) => operation()),
  );
  try {
    expect(await controller.recover()).toMatchObject({
      status: "blocked",
      code: "TARGET_NOT_ADMISSIBLE",
    });
    expect(await readdir(fixture.cacheRoot)).toEqual([]);
  } finally {
    await controller.close();
  }
});

it("defaults to disabled and never invokes maintenance or creates artifacts", async () => {
  const fixture = await makeCacheRecoveryFixture();
  roots.push(fixture.root);
  let admitted = false;
  const options = controllerOptions(fixture, "bun", async (_request, operation) => {
    admitted = true;
    return operation();
  });
  const { enabled: _enabled, ...withoutPolicy } = options;
  const controller = createCacheRecoveryController(withoutPolicy);
  try {
    const before = await readFile(fixture.target);
    expect(await controller.recover()).toEqual({ status: "blocked", code: "POLICY_DISABLED" });
    expect(admitted).toBe(false);
    expect(await readFile(fixture.target)).toEqual(before);
    expect(await readdir(fixture.cacheRoot)).toEqual(["cache.sqlite"]);
  } finally {
    await controller.close();
  }
});

it("stops candidate admission at a lowered resource bound without replacing the target", async () => {
  const fixture = await makeCacheRecoveryFixture();
  roots.push(fixture.root);
  await writeProject(fixture.sourceRoot, "bounded", "resourceboundlexeme");
  const controller = createCacheRecoveryController({
    ...controllerOptions(fixture, "bun", async (_request, operation) => operation()),
    maxCacheBytes: 128 * 1024,
  });
  try {
    const before = await readFile(fixture.target);
    expect(await controller.recover()).toMatchObject({ status: "failed", code: "CANDIDATE_SIZE" });
    expect(await readFile(fixture.target)).toEqual(before);
    const key = createHash("sha256")
      .update(JSON.stringify([fixture.cacheRoot, "cache.sqlite"]))
      .digest("hex");
    const work = path.join(fixture.cacheRoot, ".object-mcp-cache-recovery", key);
    expect(await readdir(path.join(work, "backups"))).toEqual([]);
    expect((await readdir(path.join(work, "receipts"))).length).toBe(1);
    expect((await controller.recover()).status).toBe("blocked");
    expect((await readdir(path.join(work, "receipts"))).length).toBe(1);
  } finally {
    await controller.close();
  }
});
