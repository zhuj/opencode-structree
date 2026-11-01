import { expect, test } from "bun:test";
import { FrameworkError } from "../src/lib/errors.ts";
import type { SearchHit, SourceSearchResponse, StoredObject } from "../src/lib/types.ts";
import { memoryDefinitions } from "../src/memory/registry.ts";
import { memorySearch } from "../src/memory/retrieval.ts";
import { memoryObject } from "./helpers/memory-fixture.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

function hit(stored: StoredObject): SearchHit {
  return {
    type: "memory",
    id: stored.object.id,
    name: stored.object.name,
    title: stored.object.title,
    path: stored.path,
    checksum: stored.checksum,
    score: 1,
    fulltextRank: 1,
    semanticDistance: null,
    matchedChunk: null,
    fulltextExcerpt: "Bounded lexical evidence",
  };
}

test("missing and duplicate search candidates are omitted without refill and preserve search metadata", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const valid = await framework.create("memory", memoryObject({ id: "valid" }));
    const missing = { ...hit(valid), id: "missing", path: "memories/missing.md" };
    const duplicate = { ...hit(valid), id: "duplicate", path: "memories/duplicate.md" };
    const searched: SourceSearchResponse = {
      mode: "source",
      requestedMode: "hybrid",
      indexGeneration: null,
      complete: false,
      observedCount: 8,
      issues: [{ path: "unreadable.md", code: "SCAN", message: "Unreadable source" }],
      recovery: { state: "degraded", code: "SOURCE_ONLY" },
      hits: [missing, hit(valid), duplicate],
    };
    framework.search = async () => searched;
    framework.get = async (_type, id) => {
      if (id === "missing") throw new FrameworkError("NOT_FOUND", "private missing detail");
      if (id === "duplicate") throw new FrameworkError("DUPLICATE_ID", "private duplicate detail");
      return valid;
    };

    const result = await memorySearch(framework, { query: "evidence" });

    expect(result).toMatchObject({
      mode: "source",
      requestedMode: "hybrid",
      indexGeneration: null,
      complete: false,
      observedCount: 8,
      issues: searched.issues,
      recovery: searched.recovery,
      hits: [{ id: "valid" }],
      filtering: { stage: "after-topN", refill: false, exhaustive: false, candidates: 3 },
      diagnostics: [
        {
          id: "missing",
          path: "memories/missing.md",
          issues: [{ code: "NOT_FOUND", message: "Search candidate is no longer available." }],
        },
        {
          id: "duplicate",
          path: "memories/duplicate.md",
          issues: [{ code: "DUPLICATE_ID", message: "Search candidate identity is ambiguous." }],
        },
      ],
    });
  }, memoryDefinitions);
});

test("search candidate recheck propagates scan and unexpected failures", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const valid = await framework.create("memory", memoryObject());
    framework.search = async () => ({ mode: "fulltext", indexGeneration: 7, hits: [hit(valid)] });
    for (const error of [
      new FrameworkError("SCAN", "scan failed"),
      new FrameworkError("INTERNAL", "unexpected failure"),
    ]) {
      framework.get = async () => {
        throw error;
      };
      await expect(memorySearch(framework, { query: "evidence" })).rejects.toBe(error);
    }
  }, memoryDefinitions);
});

test("search candidate recheck prioritizes cancellation over an expected invalidation", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const valid = await framework.create("memory", memoryObject());
    framework.search = async () => ({ mode: "fulltext", indexGeneration: 7, hits: [hit(valid)] });
    const controller = new AbortController();
    framework.get = async () => {
      controller.abort();
      throw new FrameworkError("NOT_FOUND", "missing");
    };

    await expect(
      memorySearch(framework, { query: "evidence" }, controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  }, memoryDefinitions);
});
