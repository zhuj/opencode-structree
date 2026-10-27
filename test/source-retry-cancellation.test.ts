import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { FrameworkError } from "../src/lib/errors.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import { createCoreRegistry } from "../src/registry.ts";

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

async function fixture(): Promise<{
  readonly directory: string;
  readonly config: ReturnType<typeof defineConfig>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "source-retry-cancellation-"));
  const root = path.join(directory, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  await writeFile(path.join(root, "projects/readable.md"), "---\nid: readable\n---\nbody\n");
  return {
    directory,
    config: defineConfig(
      { ...defaultConfig, root, embeddings: { provider: "disabled" } },
      directory,
    ),
  };
}

test("caller cancellation during retry backoff prevents another scan", async () => {
  const { directory, config } = await fixture();
  const cancellation = new AbortController();
  const reason = new FrameworkError("CANCELLED", "Caller cancelled source read.");
  let observedBackoff = false;
  let readCalls = 0;
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: async () => {
      readCalls += 1;
      setTimeout(() => {
        observedBackoff = access.status().sourceRecovery?.state === "retrying";
        cancellation.abort(reason);
      }, 0);
      throw codedError("EAGAIN");
    },
  });

  try {
    const failure = await access
      .get("project", "readable", cancellation.signal)
      .catch((error: unknown) => error);

    expect(failure).toBe(reason);
    expect(readCalls).toBe(1);
    expect(observedBackoff).toBe(true);
    expect(access.status().sourceRecovery).toEqual({
      state: "aborted",
      code: "ABORTED",
      attempts: 1,
    });
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("lifecycle cancellation during retry backoff drains source work before close", async () => {
  const { directory, config } = await fixture();
  let closing: Promise<void> | undefined;
  let observedBackoff = false;
  let readCalls = 0;
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: async () => {
      readCalls += 1;
      setTimeout(() => {
        observedBackoff = access.status().sourceRecovery?.state === "retrying";
        closing = access.close();
      }, 0);
      throw codedError("EBUSY");
    },
  });

  try {
    const failure = await access.get("project", "readable").catch((error: unknown) => error);
    await closing;

    expect(failure).toBeInstanceOf(FrameworkError);
    if (!(failure instanceof FrameworkError)) throw new Error("Expected lifecycle cancellation.");
    expect(failure.code).toBe("CLOSED");
    expect(readCalls).toBe(1);
    expect(observedBackoff).toBe(true);
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});
