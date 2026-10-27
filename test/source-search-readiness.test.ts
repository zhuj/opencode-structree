import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { FrameworkError } from "../src/lib/errors.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import type { ObjectFacade, SearchResponse, SourceSearchResponse } from "../src/lib/types.ts";
import { createCoreRegistry } from "../src/registry.ts";

const roots: string[] = [];
const accesses: Awaited<ReturnType<typeof createSourceAccess>>[] = [];
const definitions = createCoreRegistry().definitions.filter(({ name }) => name === "project");

function expectSource(response: SearchResponse): asserts response is SourceSearchResponse {
  expect(response.mode).toBe("source");
  if (response.mode !== "source") throw new Error("Expected source-only search output.");
}

afterEach(async () => {
  const closed = await Promise.allSettled(accesses.splice(0).map((access) => access.close()));
  const removed = await Promise.allSettled(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  const failures = [...closed, ...removed].flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Source-search fixture cleanup failed.");
});

async function fixture(factory?: (signal: AbortSignal) => Promise<ObjectFacade>) {
  const directory = await mkdtemp(path.join(tmpdir(), "source-search-readiness-"));
  roots.push(directory);
  const root = path.join(directory, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  const config = defineConfig(
    { ...defaultConfig, root, embeddings: { provider: "disabled" } },
    directory,
  );
  const access = await createSourceAccess({ config, definitions, ...(factory ? { factory } : {}) });
  accesses.push(access);
  return { access, root, config };
}

function delegate(
  search: ObjectFacade["search"],
  status: ObjectFacade["status"] = () => ({}),
): ObjectFacade {
  const unused = async () => {
    throw new Error("unused");
  };
  return {
    definitions,
    create: unused,
    get: unused,
    update: unused,
    delete: unused,
    list: async () => ({ objects: [], total: 0 }),
    search,
    relations: unused,
    resync: unused,
    status,
    close: async () => undefined,
  };
}

describe("source-search capability and index readiness", () => {
  test("falls back without waiting during startup and labels startup failure", async () => {
    let resolveFactory: ((facade: ObjectFacade) => void) | undefined;
    const startup = new Promise<ObjectFacade>((resolve) => {
      resolveFactory = resolve;
    });
    if (!resolveFactory) throw new Error("Factory resolver was not initialized.");
    const releaseStartup = resolveFactory;
    const { access, root } = await fixture(async () => startup);
    try {
      await writeFile(
        path.join(root, "projects/readable.md"),
        "---\nid: readable\n---\nsearchable\n",
      );
      const starting = await access.search({ query: "searchable" });
      expectSource(starting);
      expect(starting.recovery.code).toBe("CAPABILITY_STARTING");
    } finally {
      releaseStartup(delegate(async () => ({ mode: "fulltext", hits: [], indexGeneration: 1 })));
    }
    const failed = await fixture(async () => {
      throw new Error("private startup details");
    });
    await expect(failed.access.whenReady()).rejects.toMatchObject({
      code: "CAPABILITY_START_FAILED",
    });
    const fallback = await failed.access.search({ query: "searchable" });
    expectSource(fallback);
    expect(fallback.recovery.code).toBe("CAPABILITY_FAILED");
    expect(JSON.stringify(fallback)).not.toContain("private startup details");
  });

  test("preserves indexed responses, source-falls back on derived failure, and trusts unknown legacy status", async () => {
    const indexed: SearchResponse = { mode: "fulltext", hits: [], indexGeneration: 42 };
    const ready = await fixture(async () =>
      delegate(
        async () => indexed,
        () => ({}),
      ),
    );
    await ready.access.whenReady();
    expect(await ready.access.search({ query: "indexed" })).toEqual(indexed);
    const failed = await fixture(async () =>
      delegate(async () => {
        throw new FrameworkError("EMBEDDINGS_UNAVAILABLE", "private cause");
      }),
    );
    await failed.access.whenReady();
    const fallback = await failed.access.search({ query: "source" });
    expectSource(fallback);
    expect(fallback.recovery.code).toBe("DERIVED_SEARCH_FAILED");
    expect(JSON.stringify(fallback)).not.toContain("private cause");
  });

  test("uses public status to avoid claiming complete indexes or semantic rankings", async () => {
    let searches = 0;
    const cases = [
      [
        "hybrid",
        { syncing: false, dirty: false, lastSync: {}, pendingEmbeddings: 3 },
        "SEMANTIC_INDEX_NOT_READY",
      ],
      [
        "fulltext",
        { syncing: true, dirty: false, lastSync: {}, pendingEmbeddings: 0 },
        "INDEX_NOT_READY",
      ],
      [
        "fulltext",
        { syncing: false, dirty: true, lastSync: {}, pendingEmbeddings: 0 },
        "INDEX_NOT_READY",
      ],
      [
        "fulltext",
        { syncing: false, dirty: false, lastSync: null, pendingEmbeddings: 0 },
        "INDEX_NOT_READY",
      ],
    ] as const;
    for (const [mode, status, code] of cases) {
      const { access } = await fixture(async () =>
        delegate(
          async () => {
            searches += 1;
            return { mode, hits: [], indexGeneration: 1 };
          },
          () => status,
        ),
      );
      await access.whenReady();
      const result = await access.search({ query: "missing", mode });
      expectSource(result);
      expect(result.recovery.code).toBe(code);
    }
    expect(searches).toBe(0);
  });

  test("propagates cancellation without delegate fallback", async () => {
    let searches = 0;
    const { access } = await fixture(async () =>
      delegate(async () => {
        searches += 1;
        throw new FrameworkError("EMBEDDINGS_UNAVAILABLE", "unused");
      }),
    );
    await access.whenReady();
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(access.search({ query: "cancelled" }, cancellation.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(searches).toBe(0);
  });

  test("propagates validation, unknown-type, closed, and abort failures from a ready delegate", async () => {
    for (const code of ["VALIDATION", "UNKNOWN_TYPE", "CLOSED"] as const) {
      const failure = new FrameworkError(code, "private delegate failure");
      let searches = 0;
      const { access } = await fixture(async () =>
        delegate(async () => {
          searches += 1;
          throw failure;
        }),
      );
      await access.whenReady();
      await expect(access.search({ query: "valid", types: ["project"] })).rejects.toMatchObject({
        code,
      });
      expect(searches).toBe(1);
    }

    let searches = 0;
    const { access } = await fixture(async () =>
      delegate(async () => {
        searches += 1;
        throw new DOMException("cancelled", "AbortError");
      }),
    );
    await access.whenReady();
    await expect(access.search({ query: "valid" })).rejects.toMatchObject({ name: "AbortError" });
    expect(searches).toBe(1);
  });
});
