import { expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import type { RecoveryWorkerRequest } from "../src/lib/cache-recovery/protocol-types.ts";
import { runCacheRecoveryWorker } from "../src/lib/cache-recovery/worker.ts";
import { fixture } from "./materialization-fixture.ts";

test("library cache collection uses trusted host definitions and blocks missing schemas", async () => {
  const project = await fixture();
  try {
    await project.write("host-note");
    const request: RecoveryWorkerRequest = {
      version: 1,
      operation: "collect",
      sourceRoot: await realpath(project.vaultRoot),
    };
    const signal = new AbortController().signal;
    expect(await runCacheRecoveryWorker(request, signal)).toMatchObject({
      status: "blocked",
      code: "SOURCE_INCOMPLETE",
    });
    expect(await runCacheRecoveryWorker(request, signal, { definitions: [] })).toMatchObject({
      status: "blocked",
      code: "SOURCE_INCOMPLETE",
    });
    expect(
      await runCacheRecoveryWorker(request, signal, { definitions: project.definitions }),
    ).toMatchObject({ operation: "collect", status: "ok", files: 1 });
  } finally {
    await project.close();
  }
});
