import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../src/lib/sqlite/database.ts";
import { toIndexEmbeddingProvider } from "../src/lib/sqlite/embeddings.ts";
import { MutationConflictError } from "../src/lib/sqlite/errors.ts";
import { Filter } from "../src/lib/sqlite/filter.ts";
import { FTSIndex } from "../src/lib/sqlite/fts-index.ts";
import { IndexedTable, type IndexedTableOptions } from "../src/lib/sqlite/index-table.ts";
import { Table } from "../src/lib/sqlite/table.ts";
import { VectorIndex } from "../src/lib/sqlite/vector-index.ts";
import type { EmbeddedChunk, EmbeddingProvider, FrameworkConfig } from "../src/lib/types.ts";

type Driver = FrameworkConfig["sqlite"]["driver"];
const databases: Database[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function open(driver: Driver, path = ":memory:"): Database {
  const database = new Database(
    { driver, path, busyTimeoutMs: 1000 },
    { loadVectorExtension: true },
  );
  databases.push(database);
  database.initialize();
  return database;
}

interface Note {
  id: string;
  title: string;
  body: string;
  category: string;
}

class Notes extends IndexedTable<Note> {
  readonly tableName = "notes";

  constructor(database: Database, options: IndexedTableOptions<Note> = {}) {
    super(
      database,
      [
        { name: "title", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "body", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "category", sqlType: "TEXT", constraints: "NOT NULL" },
      ],
      options,
    );
  }
}

interface DocumentRow {
  object_key: string;
  object_type: string;
  checksum: string;
  embedding_fingerprint: string;
  embedding_dimensions: number;
  embedding_checksum: string;
  body: string;
}

class Documents extends Table<DocumentRow> {
  readonly tableName = "documents";

  constructor(database: Database) {
    super(
      database,
      [
        { name: "object_key", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "object_type", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "checksum", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "embedding_fingerprint", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "embedding_dimensions", sqlType: "INTEGER", constraints: "NOT NULL" },
        { name: "embedding_checksum", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "body", sqlType: "TEXT", constraints: "NOT NULL" },
      ],
      { primaryKey: "object_key" },
    );
  }
}

function chunks(text: string, ...vectors: number[][]): EmbeddedChunk[] {
  return vectors.map((vector, index) => ({
    index,
    start: 0,
    end: Array.from(text).length,
    text,
    vector: new Float32Array(vector),
  }));
}

function provider(
  database: Database,
  calls: { purpose: string; count: number }[],
  wait?: () => Promise<void> | undefined,
): EmbeddingProvider {
  return {
    dimensions: 2,
    fingerprint: "test-provider/v1",
    async embed(texts, purpose, signal) {
      // BEGIN would fail if asynchronous preparation had leaked into a caller's SQLite transaction.
      database.raw.exec("BEGIN; ROLLBACK");
      calls.push({ purpose, count: texts.length });
      await wait?.();
      signal?.throwIfAborted();
      return texts.map((text) => new Float32Array(text.includes("orchard") ? [1, 0] : [0, 1]));
    },
    async close() {},
  };
}

for (const driver of ["better-sqlite3", "bun"] as const) {
  describe(`Search abstractions (${driver})`, () => {
    test("lazy default names and trigger updates preserve original text and one row per identity", () => {
      const database = open(driver);
      const notes = new Notes(database, {
        fts: { columns: ["title", "body"], maintenance: "triggers" },
      });
      notes.initialize();
      expect(notes.ftsIndex?.tableName).toBe("notes_fts");
      notes.create({
        id: "a",
        title: 'C++ "quoted" café',
        body: "ready for launch",
        category: "one",
      });
      expect(database.raw.prepare("SELECT title FROM notes_fts WHERE id = ?").get("a")).toEqual({
        title: 'C++ "quoted" café',
      });
      expect(notes.searchFTS("cafe", Filter.eq("category", "one"))).toHaveLength(1);
      expect(notes.searchFTS('cafe OR "absent"')).toHaveLength(0);

      database.raw
        .prepare("UPDATE notes SET id = ?, title = ? WHERE id = ?")
        .run("b", "Changed needle", "a");
      expect(notes.searchFTS("needle").map((row) => row.id)).toEqual(["b"]);
      expect(database.raw.prepare("SELECT COUNT(*) AS count FROM notes_fts").get()).toEqual({
        count: 1,
      });
      expect(notes.searchFTS("cafe")).toHaveLength(0);
      expect(notes.revisions.read("a")).toBeGreaterThan(1);
      expect(notes.revisions.read("b")).toBeGreaterThan(0);

      notes.update("b", { body: "replacement" });
      expect(notes.searchFTS("launch")).toHaveLength(0);
      expect(notes.searchFTS("replacement", Filter.eq("id", "b"))).toHaveLength(1);
      expect(notes.delete("b")).toBe(true);
      expect(notes.searchFTS("replacement")).toHaveLength(0);
    });

    test("FTS initialization repairs identities and rejects incompatible columns or tokenizers", () => {
      const database = open(driver);
      const options = { columns: ["title", "body"], maintenance: "triggers" as const };
      const notes = new Notes(database, { fts: options });
      notes.initialize();
      notes.create({ id: "a", title: "first", body: "original orchard", category: "one" });
      notes.create({ id: "b", title: "second", body: "banana", category: "one" });
      database.raw.exec("DELETE FROM notes_fts WHERE id = 'b'");
      database.raw
        .prepare("INSERT INTO notes_fts(id, title, body) VALUES (?, ?, ?)")
        .run("a", "duplicate", "wrong");
      database.raw
        .prepare("INSERT INTO notes_fts(id, title, body) VALUES (?, ?, ?)")
        .run("orphan", "extra", "wrong");
      notes.ftsIndex?.initialize();
      expect(database.raw.prepare("SELECT COUNT(*) AS count FROM notes_fts").get()).toEqual({
        count: 2,
      });
      expect(notes.searchFTS("orchard").map((row) => row.id)).toEqual(["a"]);
      expect(notes.searchFTS("banana").map((row) => row.id)).toEqual(["b"]);
      expect(notes.searchFTS("wrong")).toHaveLength(0);
      expect(() => new FTSIndex(notes, { ...options, columns: ["title"] }).initialize()).toThrow(
        "migration or rebuild",
      );
      expect(() =>
        new FTSIndex(notes, { ...options, tokenizer: "porter unicode61" }).initialize(),
      ).toThrow("migration or rebuild");
      expect(notes.searchFTS("orchard")).toHaveLength(1);
    });

    test("manual extractors are synchronized by ordinary Table CRUD without escaping persisted text", () => {
      const database = open(driver);
      const notes = new Notes(database, {
        fts: {
          columns: ["search_text"],
          extractor: (row) => ({ search_text: `${row.title} ${row.body}` }),
        },
      });
      notes.initialize();
      notes.create({ id: "a", title: "A 'literal' title", body: "C++ orchard", category: "one" });
      expect(database.raw.prepare("SELECT search_text FROM notes_fts").get()).toEqual({
        search_text: "A 'literal' title C++ orchard",
      });
      notes.updateSync("a", { body: "banana" });
      expect(notes.searchFTS("orchard")).toHaveLength(0);
      expect(notes.searchFTS("banana")).toHaveLength(1);
      expect(notes.deleteSync("a")).toBe(true);
      expect(notes.searchFTS("banana")).toHaveLength(0);
    });

    test("vector filtering and whole/chunk reduction precede the document limit", () => {
      const database = open(driver);
      const documents = new Documents(database);
      documents.initialize();
      const vectors = new VectorIndex(documents, {
        freshness: {
          checksum: "checksum",
          fingerprint: "embedding_fingerprint",
          dimensions: "embedding_dimensions",
          embeddingChecksum: "embedding_checksum",
        },
        orderBy: ["object_type", "object_key"],
      });
      vectors.initialize();
      expect(vectors.tableName).toBe("documents_vec");
      const insert = (
        id: string,
        type: string,
        embeddings: number[][],
        fingerprint = "model:a",
        storedChecksum = id,
      ) => {
        documents.create({
          object_key: id,
          object_type: type,
          checksum: id,
          embedding_fingerprint: fingerprint,
          embedding_dimensions: embeddings[0]!.length,
          embedding_checksum: id,
          body: id,
        });
        vectors.replaceSync(id, vectors.prepareChunks(chunks(id, ...embeddings)), {
          fingerprint,
          checksum: storedChecksum,
        });
      };
      for (let index = 0; index < 6; index++) insert(`excluded${index}`, "excluded", [[1, 0]]);
      insert("a", "wanted", [
        [0.9, 0.1],
        [1, 0],
        [1, 0],
        [0.95, 0.1],
      ]);
      insert("b", "wanted", [[0.8, 0.4]]);
      insert("stale", "wanted", [[1, 0]], "model:a", "old");
      insert("otherModel", "wanted", [[1, 0]], "model:b");
      insert("otherDimension", "wanted", [[1, 0, 0]]);
      const result = vectors.searchRows(new Float32Array([1, 0]), {
        fingerprint: "model:a",
        filter: Filter.eq("m.object_type", "wanted"),
        limit: 2,
      });
      expect(result.map((row) => row.object_key)).toEqual(["a", "b"]);
      expect(result[0]!.chunk_index).toBe(1);
      expect(result[0]!.distance).toBeLessThan(result[1]!.distance);
      expect(
        vectors
          .searchRows(new Float32Array([1, 0]), { fingerprint: "model:b" })
          .map((row) => row.object_key),
      ).toEqual(["otherModel"]);
      expect(
        vectors.searchRows(new Float32Array([1, 0]), {
          fingerprint: "model:a",
          filter: Filter.in("object_type", []),
        }),
      ).toHaveLength(0);

      const prepared = vectors.prepareChunks(chunks("a", [1, 0]));
      prepared[0]!.bytes.fill(255);
      vectors.replaceSync("a", prepared, { checksum: "a", fingerprint: "model:a" });
      expect(
        vectors.searchRows(new Float32Array([1, 0]), {
          fingerprint: "model:a",
          filter: Filter.eq("object_key", "a"),
        })[0]!.distance,
      ).toBe(0);
      prepared[0]!.chunk.vector[0] = Number.NaN;
      expect(() =>
        vectors.replaceSync("a", prepared, { checksum: "a", fingerprint: "model:a" }),
      ).toThrow("finite");
      expect(vectors.storage.readAll(Filter.eq("object_key", "a"))).toHaveLength(1);
    });

    test("prepared mutations await providers outside SQL and atomically publish, retry, and repair indexes", async () => {
      const database = open(driver);
      const calls: { purpose: string; count: number }[] = [];
      const notes = new Notes(database, {
        fts: { columns: ["title", "body"], maintenance: "triggers" },
        vector: {
          extractor: (row) => row.body,
          provider: toIndexEmbeddingProvider(provider(database, calls)),
        },
      });
      notes.initialize();
      expect(notes.vectorIndex?.tableName).toBe("notes_vec");
      const prepared = await notes.prepareCreate({
        id: "a",
        title: "An orchard",
        body: "orchard",
        category: "one",
      });
      expect(calls).toEqual([{ purpose: "document", count: 1 }]);
      expect(notes.read("a")).toBeUndefined();
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(0);
      expect(() =>
        prepared.commit(() => {
          throw new Error("Reject transaction");
        }),
      ).toThrow("Reject transaction");
      expect(notes.read("a")).toBeUndefined();
      expect(notes.revisions.read("a")).toBe(0);
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(0);
      expect(prepared.commit().id).toBe("a");
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(2);
      expect(() => prepared.commit()).toThrow(MutationConflictError);
      expect((await notes.searchByText("orchard"))[0]!.row.id).toBe("a");
      expect(calls.at(-1)?.purpose).toBe("query");
      expect((await notes.hybridSearch("orchard", undefined, 1))[0]!.combined).toBeCloseTo(
        1 / 61,
        12,
      );

      notes.update("a", { title: "A banana", body: "banana" });
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(0);
      expect(notes.searchFTS("banana")).toHaveLength(1);
      const firstRepair = await notes.prepareIndexRepair("a");
      const secondRepair = await notes.prepareIndexRepair("a");
      const revision = notes.revisions.read("a");
      firstRepair.commit();
      expect(notes.revisions.read("a")).toBeGreaterThan(revision);
      expect(() => secondRepair.commit()).toThrow(MutationConflictError);
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(2);
      expect(notes.prepareDelete("a").commit()).toBe(true);
      expect(notes.searchFTS("banana")).toHaveLength(0);
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(0);
    });

    test("persistent revisions reject a prepare after another connection writes equal source values", async () => {
      const root = mkdtempSync(join(tmpdir(), "object-mcp-search-abstractions-"));
      roots.push(root);
      const path = join(root, "index.sqlite");
      const first = open(driver, path);
      let gate: Promise<void> | undefined;
      let release = () => {};
      const calls: { purpose: string; count: number }[] = [];
      const notes = new Notes(first, {
        fts: { columns: ["body"], maintenance: "triggers" },
        vector: {
          extractor: (row) => row.body,
          provider: toIndexEmbeddingProvider(provider(first, calls, () => gate)),
        },
      });
      notes.initialize();
      (
        await notes.prepareCreate({ id: "a", title: "Initial", body: "orchard", category: "one" })
      ).commit();
      const second = open(driver, path);
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const preparation = notes.prepareUpdate("a", { body: "banana" });
      second.raw.prepare("UPDATE notes SET body = body WHERE id = ?").run("a");
      release();
      const prepared = await preparation;
      expect(() => prepared.commit()).toThrow(MutationConflictError);
      expect(notes.read("a")?.body).toBe("orchard");
      expect(notes.searchFTS("orchard")).toHaveLength(1);
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(2);
    });

    test("public vector insertion rejects stale input and concurrent source changes", async () => {
      const database = open(driver);
      let gate: Promise<void> | undefined;
      let release = () => {};
      const calls: { purpose: string; count: number }[] = [];
      const notes = new Notes(database, {
        vector: {
          extractor: (row) => row.body,
          provider: toIndexEmbeddingProvider(provider(database, calls, () => gate)),
        },
      });
      notes.initialize();
      const oldRow = (
        await notes.prepareCreate({ id: "a", title: "Initial", body: "orchard", category: "one" })
      ).commit();
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const insertion = notes.vectorIndex!.insertRow(oldRow);
      notes.updateSync("a", { body: "banana" });
      release();
      await expect(insertion).rejects.toThrow(MutationConflictError);
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(0);
      await expect(notes.vectorIndex!.insertRow(oldRow)).rejects.toThrow(MutationConflictError);
      expect(notes.read("a")?.body).toBe("banana");
      expect(calls).toHaveLength(2);
    });

    test("cancellation after preparation prevents the deferred commit from changing source or indexes", async () => {
      const database = open(driver);
      const notes = new Notes(database, {
        fts: { columns: ["body"], maintenance: "triggers" },
        vector: {
          extractor: (row) => row.body,
          provider: toIndexEmbeddingProvider(provider(database, [])),
        },
      });
      notes.initialize();
      const creationAbort = new AbortController();
      const create = await notes.prepareCreate(
        { id: "absent", title: "No write", body: "orchard", category: "one" },
        creationAbort.signal,
      );
      creationAbort.abort(new Error("Cancelled deferred creation"));
      expect(() => create.commit()).toThrow("Cancelled deferred creation");
      expect(notes.read("absent")).toBeUndefined();
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(0);

      (
        await notes.prepareCreate({ id: "a", title: "Keep", body: "orchard", category: "one" })
      ).commit();
      const abort = new AbortController();
      const update = await notes.prepareUpdate("a", { body: "banana" }, abort.signal);
      const upsert = await notes.prepareUpsert("a", { body: "banana" }, true, abort.signal);
      const repair = await notes.prepareIndexRepair("a", abort.signal);
      const deletion = notes.prepareDelete("a", abort.signal);
      const revision = notes.revisions.read("a");
      abort.abort(new Error("Cancelled deferred mutation"));
      for (const operation of [update, upsert, repair, deletion])
        expect(() => operation.commit()).toThrow("Cancelled deferred mutation");
      expect(notes.revisions.read("a")).toBe(revision);
      expect(notes.read("a")?.body).toBe("orchard");
      expect(notes.searchFTS("orchard")).toHaveLength(1);
      expect(notes.vectorIndex?.storage.readAll()).toHaveLength(2);
    });
  });
}

test("embedding adapter preserves provider purpose/cancellation without taking ownership", async () => {
  const calls: { purpose: string; signal: AbortSignal | undefined }[] = [];
  let closed = false;
  const shared: EmbeddingProvider = {
    dimensions: 2,
    fingerprint: "shared",
    async embed(texts, purpose, signal) {
      calls.push({ purpose, signal });
      return texts.map(() => new Float32Array([1, 0]));
    },
    async close() {
      closed = true;
    },
  };
  const adapted = toIndexEmbeddingProvider(shared);
  const signal = new AbortController().signal;
  expect(await adapted.embed("query", "query", signal)).toEqual(new Float32Array([1, 0]));
  expect(await adapted.embedBatch(["a", "b"], "document", signal)).toHaveLength(2);
  expect(calls).toEqual([
    { purpose: "query", signal },
    { purpose: "document", signal },
  ]);
  expect(closed).toBe(false);
});

test("legacy embedder preparation drains started calls when one callback throws synchronously", async () => {
  const database = open("better-sqlite3");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  const body = "orchard banana meadow";
  const notes = new Notes(database, {
    vector: {
      dimensions: 2,
      fingerprint: "legacy-embedder/v1",
      chunks: { size: 5, overlap: 0.1 },
      extractor: (row) => row.body,
      embedder: (text) => {
        if (text === body) throw new Error("Synchronous provider failure");
        active++;
        return gate.then(() => {
          active--;
          return new Float32Array([1, 0]);
        });
      },
    },
  });
  notes.initialize();
  let settled = false;
  const preparation = notes.prepareCreate({ id: "a", title: "No write", body, category: "one" });
  void preparation.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(active).toBeGreaterThan(0);
  expect(settled).toBe(false);
  release();
  await expect(preparation).rejects.toThrow("Synchronous provider failure");
  expect(active).toBe(0);
  expect(notes.read("a")).toBeUndefined();
  expect(notes.vectorIndex?.storage.readAll()).toHaveLength(0);
});
