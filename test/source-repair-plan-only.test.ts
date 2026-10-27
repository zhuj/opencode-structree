import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const scratch: string[] = [];
afterEach(async () =>
  Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("plans repairs in an isolated Bun process without loading SQLite coordination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "object-mcp-plan-only-"));
  scratch.push(root);
  const modulePath = path.resolve("src/lib/sqlite/process-lock.ts");
  const sourcePath = path.resolve("src/lib/source-repair/index.ts");
  const script = `
    import { mock } from "bun:test";
    mock.module(${JSON.stringify(modulePath)}, () => {
      throw new Error("SQLite process-lock import must remain lazy during planning");
    });
    import { writeFile } from "node:fs/promises";
    const root = process.env.SOURCE_REPAIR_TEST_ROOT;
    await writeFile(root + "/invalid.md", Buffer.from([255]));
    const { createSourceRepairSession } = await import(${JSON.stringify(sourcePath)});
    const session = await createSourceRepairSession({ root, driver: "bun" });
    try {
      const plan = await session.planReplacement({ sourcePath: "invalid.md", payload: Buffer.from([254]) });
      if (plan.beforeChecksum === null) throw new Error("Missing whole-file revision");
    } finally {
      await session.close();
    }
  `;
  const result = spawnSync("bun", ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, SOURCE_REPAIR_TEST_ROOT: root },
  });
  expect(result.status).toBe(0);
});
