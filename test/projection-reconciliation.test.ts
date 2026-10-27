import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFramework, type ObjectFramework } from "../src/framework.ts";
import type { EmbeddingProvider } from "../src/lib/types.ts";

const directories: string[] = [];
const frameworks: ObjectFramework[] = [];

afterEach(async () => {
  const failures: unknown[] = [];
  try {
    const closed = await Promise.allSettled(
      frameworks.splice(0).map((framework) => framework.close()),
    );
    failures.push(
      ...closed.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
  } finally {
    const removed = await Promise.allSettled(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
    failures.push(
      ...removed.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
  }
  if (failures.length) throw new AggregateError(failures, "Projection fixture cleanup failed.");
});

class CountingProvider implements EmbeddingProvider {
  readonly dimensions = 2;
  readonly fingerprint = "projection-test-v1";
  prepareCalls = 0;
  documentCalls = 0;

  async prepare(): Promise<void> {
    this.prepareCalls++;
  }

  async embed(
    texts: readonly string[],
    purpose: "document" | "query",
  ): Promise<readonly Float32Array[]> {
    if (purpose === "document") this.documentCalls++;
    return texts.map(() => Float32Array.from([1, 0]));
  }

  async close(): Promise<void> {}
}

async function create(
  directory: string,
  provider: EmbeddingProvider,
  reconciliation?: "maintenance" | "projection",
) {
  const framework = await createFramework({
    baseDirectory: directory,
    ...(reconciliation ? { reconciliation } : {}),
    config: {
      root: "objects",
      sqlite: { path: "cache/index.sqlite" },
      embeddings: { provider: "disabled" },
      chunking: { size: 200 },
      sync: { watch: false, debounceMs: 0, rescanIntervalMs: 0, maxFileBytes: 1_000 },
    },
    embeddingProvider: provider,
  });
  frameworks.push(framework);
  return framework;
}

describe("projection reconciliation", () => {
  test("refreshes lexical metadata without renaming source or invoking embeddings", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "projection-reconciliation-"));
    directories.push(directory);
    const provider = new CountingProvider();
    const maintenance = await create(directory, provider);
    const source = await maintenance.create(
      "project",
      {
        id: "p-1",
        name: "p-1",
        title: "Existing title",
        description: "Architecture project",
        createdAt: new Date("2026-10-15T12:00:00.000Z"),
        updatedAt: new Date("2026-10-15T12:00:00.000Z"),
        retiredAt: null,
        tags: {},
        metadata: {},
        relations: { partOf: null },
      },
      "Original searchable body",
    );
    const cachedButMissing = await maintenance.create(
      "project",
      {
        id: "p-2",
        name: "p-2",
        title: "Cached object",
        description: "Must remain while coverage is unknown",
        createdAt: new Date("2026-10-15T12:00:00.000Z"),
        updatedAt: new Date("2026-10-15T12:00:00.000Z"),
        retiredAt: null,
        tags: {},
        metadata: {},
        relations: { partOf: null },
      },
      "Cached body",
    );
    await maintenance.close();
    frameworks.splice(frameworks.indexOf(maintenance), 1);

    const sourcePath = path.join(directory, "objects", source.path);
    await unlink(path.join(directory, "objects", cachedButMissing.path));
    const misplaced = path.join(
      directory,
      "objects",
      source.path.replace("p-1.md", "legacy-name.md"),
    );
    await rename(sourcePath, misplaced);
    await writeFile(
      misplaced,
      (await readFile(misplaced, "utf8")).replace(
        "Original searchable body",
        "Projection-only lexical phrase",
      ),
    );
    const originalMisplacedBytes = await readFile(misplaced);
    await writeFile(
      path.join(directory, "objects", "projects", "invalid-utf8.md"),
      Buffer.from([0xff]),
    );
    await writeFile(path.join(directory, "objects", "projects", "oversized.md"), "x".repeat(1_001));
    await writeFile(
      path.join(directory, "objects", "projects", "partial.md"),
      "---\nid: p-3\n---\nSemantic partial searchable text",
    );
    const callsBeforeProjection = provider.documentCalls;
    const projection = await create(directory, provider, "projection");

    await projection.resync();
    expect(await readFile(misplaced)).toEqual(originalMisplacedBytes);
    await expect(readFile(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(provider.prepareCalls).toBe(0);
    expect(provider.documentCalls).toBe(callsBeforeProjection);
    expect(projection.status()).toMatchObject({ objects: 3, pendingEmbeddings: 3 });
    expect(
      (await projection.search({ query: "Projection-only lexical phrase", mode: "fulltext" })).hits,
    ).toHaveLength(1);
    expect(
      (await projection.search({ query: "Semantic partial searchable text", mode: "fulltext" }))
        .hits,
    ).toHaveLength(1);
  });
});
