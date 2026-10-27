import { expect, it } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runRecoveryWorker,
  withWorkerOutputForTest,
} from "../src/lib/cache-recovery/worker-client.ts";

it("responds on the parent event loop and reaps a child blocked in synchronous native SQLite", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "cache-native-drain-"));
  try {
    const root = await realpath(scratch);
    const entrypoint = path.join(root, "held-worker.ts");
    // Native work cannot service the handler; cancellation must reach the SIGKILL/reap path.
    await writeFile(
      entrypoint,
      [
        'import { Database } from "bun:sqlite";',
        'process.on("SIGTERM", () => {});',
        'const db = new Database(":memory:");',
        'process.stdout.write("native-ready");',
        'try { db.query("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000000000000) SELECT sum(x) FROM n").get(); } finally { db.close(); }',
      ].join("\n"),
    );
    const cancellation = new AbortController();
    let pid: number | undefined;
    let responsive = false;
    const result = await withWorkerOutputForTest(
      (ownedPid) => {
        pid = ownedPid;
        queueMicrotask(() => {
          responsive = true;
          cancellation.abort();
        });
      },
      () =>
        runRecoveryWorker({
          entrypoint,
          cwd: root,
          request: { version: 1, operation: "collect", sourceRoot: root },
          timeoutMs: 5000,
          signal: cancellation.signal,
        }),
    );
    expect(responsive).toBe(true);
    expect(result).toEqual({ status: "blocked", code: "CANCELLED" });
    expect(pid).toBeDefined();
    if (pid === undefined) throw new Error("Owned child did not start.");
    const ownedPid = pid;
    expect(() => process.kill(ownedPid, 0)).toThrow();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
