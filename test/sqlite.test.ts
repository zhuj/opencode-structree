import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBunLibraryGuard } from "../src/lib/sqlite/driver.ts";
import { literalFtsQuery, SqliteIndex } from "../src/lib/sqlite/index.ts";
import type { EmbeddedChunk, FrameworkConfig, SourceDocument } from "../src/lib/types.ts";

const search: FrameworkConfig["search"] = {
  defaultTopN: 10,
  maxTopN: 100,
  candidateMultiplier: 4,
  rrfK: 60,
  fulltextWeight: 1,
  semanticWeight: 1,
  maxMatchCharacters: 1200,
};
const roots: string[] = [];
const databases: SqliteIndex[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function open(
  driver: FrameworkConfig["sqlite"]["driver"],
  path = ":memory:",
  searchConfig = search,
): SqliteIndex {
  const database = new SqliteIndex({ path, driver, busyTimeoutMs: 1000 }, searchConfig);
  databases.push(database);
  return database;
}

function source(type: string, id: string, body: string, name = id, title = name): SourceDocument {
  const object = {
    id,
    name,
    title,
    description: "Index fixture",
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
    updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    retiredAt: null,
    tags: {},
    metadata: {},
  };
  const json = {
    ...object,
    createdAt: object.createdAt.toISOString(),
    updatedAt: object.updatedAt.toISOString(),
  };
  const raw = `---\nid: ${JSON.stringify(id)}\nname: ${JSON.stringify(name)}\ntitle: ${JSON.stringify(title)}\n---\n${body}`;
  return {
    key: JSON.stringify([type, id]),
    type,
    object,
    body,
    json,
    raw,
    path: `/fixture/${type}/${encodeURIComponent(JSON.stringify(id))}.md`,
    checksum: createHash("sha256").update(raw).digest("hex"),
  };
}

function embeddings(document: SourceDocument, ...vectors: number[][]): EmbeddedChunk[] {
  return vectors.map((vector, index) => ({
    index,
    text: document.raw,
    start: 0,
    end: Array.from(document.raw).length,
    vector: new Float32Array(vector),
  }));
}

for (const driver of ["better-sqlite3", "bun"] as const) {
  describe(`SQLite index (${driver})`, () => {
    test("loads the real sqlite-vec extension and FTS5; literal Unicode queries respect type filters", () => {
      const database = open(driver);
      const project = source("project", "p1", "café green trees launch 🚀", "café", "Green trees");
      const feature = source("feature", "f1", "green trees launch", "green", "Trees");
      expect(database.upsertDocument(project)).toBe(true);
      expect(database.upsertDocument(feature)).toBe(true);
      const generation = database.status().generation;
      expect(database.upsertDocument(project)).toBe(false);
      expect(database.status().generation).toBe(generation);
      expect(database.status().vectorVersion).toContain("v0.1.9");
      expect(
        database.search({ query: "cafe green", mode: "fulltext" }).hits.map((hit) => hit.id),
      ).toEqual(["p1"]);
      const filtered = database.search({
        query: "green trees",
        mode: "fulltext",
        types: ["feature"],
        includeBody: true,
      });
      expect(filtered.hits).toHaveLength(1);
      expect(filtered.hits[0]!.body).toBe(feature.body);
      expect(filtered.hits[0]!.fulltextRank).toBe(1);
      expect(filtered.hits[0]!.semanticDistance).toBeNull();
      expect(database.search({ query: "green", mode: "fulltext" }).hits[0]).not.toHaveProperty(
        "body",
      );
      expect(database.search({ query: 'green OR "missing"', mode: "fulltext" }).hits).toHaveLength(
        0,
      );
      expect(database.search({ query: "' OR 1=1 --", mode: "fulltext" }).hits).toHaveLength(0);
      expect(database.search({ query: "--- : () *", mode: "fulltext" }).hits).toHaveLength(0);
      expect(database.search({ query: "green", mode: "fulltext", types: [] }).hits).toHaveLength(0);
    });

    test("type restriction and distinct-document ranking happen before semantic top-N", () => {
      const database = open(driver);
      for (let index = 0; index < 8; index++) {
        const excluded = source("excluded", `e${index}`, "strong excluded match");
        database.upsertDocument(excluded);
        database.replaceEmbeddings(
          excluded.key,
          excluded.checksum,
          "model:v1",
          embeddings(excluded, [1, 0]),
        );
      }
      const best = source("wanted", "a", "many nearby chunks");
      const next = source("wanted", "b", "another document");
      const worst = source("wanted", "c", "less nearby");
      for (const document of [best, next, worst]) database.upsertDocument(document);
      database.replaceEmbeddings(
        best.key,
        best.checksum,
        "model:v1",
        embeddings(best, [0.9, 0.2], [0.95, 0.1], [0.96, 0.1], [0.94, 0.1]),
      );
      database.replaceEmbeddings(next.key, next.checksum, "model:v1", embeddings(next, [0.8, 0.4]));
      database.replaceEmbeddings(worst.key, worst.checksum, "model:v1", embeddings(worst, [0, 1]));
      const result = database.search(
        { query: "anything", mode: "semantic", types: ["wanted"], topN: 2 },
        new Float32Array([1, 0]),
        "model:v1",
      );
      expect(result.hits.map((hit) => hit.id)).toEqual(["a", "b"]);
      expect(result.hits[0]!.matchedChunk?.index).toBe(2);
      expect(result.hits[0]!.semanticDistance).toBeLessThan(result.hits[1]!.semanticDistance!);
      expect(
        database.search({ query: "anything", mode: "semantic", types: [], topN: 2 }).hits,
      ).toHaveLength(0);
    });

    test("hybrid search combines document ranks using configurable reciprocal rank fusion", () => {
      const database = open(driver, ":memory:", {
        ...search,
        fulltextWeight: 2,
        semanticWeight: 1,
      });
      const lexical = source(
        "project",
        "lexical",
        "orchard orchard orchard orchard",
        "orchard",
        "orchard",
      );
      const semantic = source("project", "semantic", "fruit farming practices");
      for (const document of [lexical, semantic]) database.upsertDocument(document);
      database.replaceEmbeddings(
        lexical.key,
        lexical.checksum,
        "hybrid",
        embeddings(lexical, [0, 1]),
      );
      database.replaceEmbeddings(
        semantic.key,
        semantic.checksum,
        "hybrid",
        embeddings(semantic, [1, 0]),
      );
      const result = database.search(
        { query: "orchard", mode: "hybrid", topN: 2 },
        new Float32Array([1, 0]),
        "hybrid",
      );
      expect(result.hits.map((hit) => hit.id)).toEqual(["lexical", "semantic"]);
      expect(result.hits[0]!.score).toBeCloseTo(2 / 61 + 1 / 62, 12);
      expect(result.hits[1]!.score).toBeCloseTo(1 / 61, 12);
      expect(result.hits[1]!.fulltextRank).toBeNull();
    });

    test("source edits remove stale vectors atomically and reject late embedding publication", () => {
      const database = open(driver);
      const before = source("project", "same/id", "obsolete keyword");
      database.upsertDocument(before);
      database.replaceEmbeddings(
        before.key,
        before.checksum,
        "model:v1",
        embeddings(before, [1, 0]),
      );
      expect(database.needsEmbeddings(before.key, before.checksum, "model:v1")).toBe(false);
      const after = source("project", "same/id", "replacement keyword");
      database.upsertDocument(after);
      const generation = database.status().generation;
      expect(database.status().embeddingRows).toBe(0);
      expect(database.status().pendingEmbeddings).toBe(1);
      expect(database.search({ query: "obsolete", mode: "fulltext" }).hits).toHaveLength(0);
      expect(database.search({ query: "replacement", mode: "fulltext" }).hits).toHaveLength(1);
      expect(
        database.replaceEmbeddings(
          before.key,
          before.checksum,
          "model:v1",
          embeddings(before, [1, 0]),
        ),
      ).toBe(false);
      expect(database.status().generation).toBe(generation);
      expect(database.needsEmbeddings(after.key, after.checksum, "model:v1")).toBe(true);
      expect(
        database.search({ query: "query", mode: "semantic" }, new Float32Array([1, 0]), "model:v1")
          .hits,
      ).toHaveLength(0);
      expect(database.getMetadata(after.key)?.checksum).toBe(after.checksum);
    });

    test("model and dimension changes never mix incompatible vector spaces", () => {
      const database = open(driver);
      const a = source("project", "a", "one space");
      const b = source("project", "b", "another space");
      for (const document of [a, b]) database.upsertDocument(document);
      database.replaceEmbeddings(a.key, a.checksum, "model:v1:dim2", embeddings(a, [1, 0]));
      database.replaceEmbeddings(b.key, b.checksum, "model:v2:dim3", embeddings(b, [1, 0, 0]));
      expect(database.status("model:v2:dim3").embeddedObjects).toBe(1);
      expect(database.status("model:v2:dim3").cachedEmbeddedObjects).toBe(2);
      expect(database.status("model:v2:dim3").pendingEmbeddings).toBe(1);
      expect(database.needsEmbeddings(a.key, a.checksum, "model:v2:dim3")).toBe(true);
      expect(
        database
          .search({ query: "q", mode: "semantic" }, new Float32Array([1, 0, 0]), "model:v2:dim3")
          .hits.map((hit) => hit.id),
      ).toEqual(["b"]);
      expect(
        database.search({ query: "q", mode: "semantic" }, new Float32Array([1, 0]), "model:v2:dim3")
          .hits,
      ).toHaveLength(0);
      database.replaceEmbeddings(a.key, a.checksum, "model:v2:dim3", embeddings(a, [1, 0, 0]));
      expect(database.status("model:v2:dim3").embeddedObjects).toBe(2);
      expect(
        database.search({ query: "q", mode: "semantic" }, new Float32Array([1, 0]), "model:v1:dim2")
          .hits,
      ).toHaveLength(0);
      expect(
        database
          .search({ query: "q", mode: "semantic" }, new Float32Array([1, 0, 0]), "model:v2:dim3")
          .hits.map((hit) => hit.id),
      ).toEqual(["a", "b"]);
    });

    test("rejects malformed or source-mismatched chunks without replacing existing vectors", () => {
      const database = open(driver);
      const document = source("project", "a", "🚀 complete source text");
      database.upsertDocument(document);
      database.replaceEmbeddings(
        document.key,
        document.checksum,
        "good",
        embeddings(document, [1, 0]),
      );
      const generation = database.status().generation;
      expect(() =>
        database.replaceEmbeddings(
          document.key,
          document.checksum,
          "bad",
          embeddings(document, [0, 0]),
        ),
      ).toThrow("nonzero");
      expect(() =>
        database.replaceEmbeddings(
          document.key,
          document.checksum,
          "bad",
          embeddings(document, [1, Number.NaN]),
        ),
      ).toThrow("finite");
      expect(() =>
        database.replaceEmbeddings(
          document.key,
          document.checksum,
          "bad",
          embeddings(document, [1, 0], [1, 0, 0]),
        ),
      ).toThrow("dimensions");
      expect(() =>
        database.replaceEmbeddings(document.key, document.checksum, "bad", [
          { index: 0, text: "wrong", start: 0, end: 5, vector: new Float32Array([1, 0]) },
        ]),
      ).toThrow("complete current Markdown");
      expect(database.status().generation).toBe(generation);
      expect(database.needsEmbeddings(document.key, document.checksum, "good")).toBe(false);
      expect(database.status().embeddingRows).toBe(1);
      expect(() => database.search({ query: "q", mode: "semantic" })).toThrow("requires");
      expect(() =>
        database.search({ query: "q", mode: "semantic" }, new Float32Array([0, 0]), "good"),
      ).toThrow("nonzero");
    });

    test("matched excerpts obey the configured codepoint cap and report their actual offsets", () => {
      const database = open(driver, ":memory:", { ...search, maxMatchCharacters: 5 });
      const document = source("project", "a", "🚀abcdefghi");
      const start = Array.from(document.raw).indexOf("🚀");
      database.upsertDocument(document);
      database.replaceEmbeddings(document.key, document.checksum, "excerpt", [
        ...embeddings(document, [0, 1]),
        { index: 1, text: "🚀abcdefghi", start, end: start + 10, vector: new Float32Array([1, 0]) },
      ]);
      const hit = database.search(
        { query: "q", mode: "semantic" },
        new Float32Array([1, 0]),
        "excerpt",
      ).hits[0]!;
      expect(hit.matchedChunk).toEqual({ index: 1, start, end: start + 5, text: "🚀abcd" });
      const whole = database.search(
        { query: "q", mode: "semantic" },
        new Float32Array([0, 1]),
        "excerpt",
      ).hits[0]!;
      expect(whole.matchedChunk).toEqual({
        index: 0,
        start: 0,
        end: 5,
        text: Array.from(document.raw).slice(0, 5).join(""),
      });
      expect(() => open(driver, ":memory:", { ...search, maxMatchCharacters: 0 })).toThrow(
        "maxMatchCharacters",
      );
    });

    test("renames preserve vectors; deletions remove metadata, FTS, and vectors; restart preserves issues and generations", () => {
      const root = mkdtempSync(join(tmpdir(), `object-mcp-${driver}-`));
      roots.push(root);
      const path = join(root, "index.sqlite");
      const database = open(driver, path);
      const a = source("project", "a", "durable semantic orchard");
      const b = source("project", "b", "removed banana");
      for (const document of [a, b]) {
        database.upsertDocument(document);
        database.replaceEmbeddings(
          document.key,
          document.checksum,
          "persist",
          embeddings(document, [1, 0]),
        );
      }
      expect(database.upsertDocument({ ...a, path: "/renamed/a.md" })).toBe(true);
      expect(database.needsEmbeddings(a.key, a.checksum, "persist")).toBe(false);
      expect(database.getMetadata(a.key)?.path).toBe("/renamed/a.md");
      expect(database.removeMissing(new Set([a.key]))).toBe(1);
      expect(database.removeMissing(new Set([a.key]))).toBe(0);
      expect(database.search({ query: "banana", mode: "fulltext" }).hits).toHaveLength(0);
      expect(database.status().embeddingRows).toBe(1);
      database.setIssues([
        { path: "/broken.md", code: "validation", message: "Required field missing" },
      ]);
      const generation = database.status().generation;
      database.close();
      const reopened = open(driver, path);
      expect(reopened.status().generation).toBe(generation);
      expect(reopened.status().issues).toEqual([
        { path: "/broken.md", code: "validation", message: "Required field missing" },
      ]);
      expect(
        reopened
          .search({ query: "orchard", mode: "hybrid" }, new Float32Array([1, 0]), "persist")
          .hits.map((hit) => hit.id),
      ).toEqual(["a"]);
      expect(reopened.removeKeys([a.key, a.key])).toBe(1);
      expect(reopened.status().objects).toBe(0);
      expect(reopened.status().embeddingRows).toBe(0);
      expect(reopened.removeMissing([])).toBe(0);
    });

    test("a second connection cannot publish a result computed for an earlier checksum", () => {
      const root = mkdtempSync(join(tmpdir(), `object-mcp-cas-${driver}-`));
      roots.push(root);
      const path = join(root, "index.sqlite");
      const first = open(driver, path);
      const second = open(driver, path);
      const before = source("project", "a", "earlier text");
      first.upsertDocument(before);
      expect(second.getMetadata(before.key)?.checksum).toBe(before.checksum);
      const after = source("project", "a", "newer text");
      first.upsertDocument(after);
      expect(
        second.replaceEmbeddings(before.key, before.checksum, "late", embeddings(before, [1, 0])),
      ).toBe(false);
      expect(first.status().embeddingRows).toBe(0);
      expect(second.getMetadata(after.key)?.raw).toBe(after.raw);
    });

    test("JSON identities preserve distinct lone-surrogate IDs and exact labels across search and reopen", () => {
      const root = mkdtempSync(join(tmpdir(), `object-mcp-unicode-${driver}-`));
      roots.push(root);
      const path = join(root, "index.sqlite");
      const database = open(driver, path);
      const a = source("project", "\ud800", "shared orchard", "name-\ud800", "title-\ud800");
      const b = source("project", "\ud801", "shared orchard", "name-\ud801", "title-\ud801");
      for (const document of [b, a]) {
        expect(database.upsertDocument(document)).toBe(true);
        database.replaceEmbeddings(
          document.key,
          document.checksum,
          "unicode",
          embeddings(document, [1, 0]),
        );
        expect(database.upsertDocument(document)).toBe(false);
        const metadata = database.getMetadata(document.key)!;
        expect([metadata.id, metadata.name, metadata.title]).toEqual([
          document.object.id,
          document.object.name,
          document.object.title,
        ]);
      }
      expect(database.status().objects).toBe(2);
      expect(
        database
          .search({ query: "orchard", mode: "fulltext" })
          .hits.map((hit) => [hit.id, hit.name, hit.title]),
      ).toEqual([
        [a.object.id, a.object.name, a.object.title],
        [b.object.id, b.object.name, b.object.title],
      ]);
      expect(
        database.search(
          { query: "q", mode: "semantic", topN: 1 },
          new Float32Array([1, 0]),
          "unicode",
        ).hits[0]!.id,
      ).toBe(a.object.id);
      database.close();
      const reopened = open(driver, path);
      expect(reopened.getMetadata(a.key)?.id).toBe(a.object.id);
      expect(reopened.getMetadata(b.key)?.id).toBe(b.object.id);
      expect(
        reopened
          .search({ query: "q", mode: "semantic" }, new Float32Array([1, 0]), "unicode")
          .hits.map((hit) => [hit.id, hit.name, hit.title]),
      ).toEqual([
        [a.object.id, a.object.name, a.object.title],
        [b.object.id, b.object.name, b.object.title],
      ]);
    });
  });
}

test("literal FTS expressions reject excessive terms and keep user operators literal", () => {
  expect(literalFtsQuery("green OR trees:title")).toBe('"green" AND "OR" AND "trees" AND "title"');
  expect(literalFtsQuery("--- ** ()")).toBeUndefined();
  expect(() =>
    literalFtsQuery(Array.from({ length: 129 }, (_, index) => `word${index}`).join(" ")),
  ).toThrow("128");
});

test("Bun custom-library selection is reused across connections and conflicts are rejected", () => {
  const guard = createBunLibraryGuard();
  const selected: string[] = [];
  const setter = (filename: string) => {
    selected.push(filename);
    return true;
  };
  guard("/sqlite/custom.dylib", setter);
  guard("/sqlite/custom.dylib", setter);
  guard(undefined, setter);
  expect(selected).toEqual(["/sqlite/custom.dylib"]);
  expect(() => guard("/sqlite/different.dylib", setter)).toThrow("different library selection");
  const initializedDefault = createBunLibraryGuard();
  initializedDefault(undefined, setter);
  expect(() => initializedDefault("/sqlite/custom.dylib", setter)).toThrow("before opening");
  const retry = createBunLibraryGuard();
  expect(() => retry("/sqlite/custom.dylib", () => false)).toThrow("could not select");
  expect(() => retry("/sqlite/custom.dylib", setter)).not.toThrow();
});
