import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateConverter } from "../src/lib/sqlite/column.ts";
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

interface CollidingNote {
  id: string;
  title: string;
  body: string;
  /** Shares its name with the FTS ranking metadata. */
  lexical_score: Date;
  /** Shares its name with the vector ranking metadata. */
  distance: number;
  chunk_index: number;
}

/** A source table whose columns collide with the names of the ranking metadata. */
class CollidingNotes extends IndexedTable<CollidingNote> {
  readonly tableName = "colliding_notes";

  constructor(database: Database, options: IndexedTableOptions<CollidingNote> = {}) {
    super(
      database,
      [
        { name: "title", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "body", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "lexical_score", sqlType: "TEXT", converter: dateConverter },
        { name: "distance", sqlType: "INTEGER" },
        { name: "chunk_index", sqlType: "INTEGER" },
      ],
      options,
    );
  }
}

interface VectorDocument {
  id: string;
  body: string;
  checksum: string;
  embedding_fingerprint: string;
  embedding_dimensions: number;
  embedding_checksum: string;
  distance: number;
  chunk_index: number;
}

/** A vector source table whose columns collide with the names of the ranking metadata. */
class VectorDocuments extends Table<VectorDocument> {
  readonly tableName = "vector_documents";

  constructor(database: Database) {
    super(
      database,
      [
        { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "body", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "checksum", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "embedding_fingerprint", sqlType: "TEXT" },
        { name: "embedding_dimensions", sqlType: "INTEGER" },
        { name: "embedding_checksum", sqlType: "TEXT" },
        { name: "distance", sqlType: "INTEGER" },
        { name: "chunk_index", sqlType: "INTEGER" },
      ],
      { primaryKey: "id" },
    );
  }
}

interface CaseKeyRow {
  id: string;
  value: string;
}

/** A case-insensitive identity, so several spellings resolve to the same row. */
class CaseInsensitiveKeys extends IndexedTable<CaseKeyRow> {
  readonly tableName = "case_keys";

  constructor(database: Database) {
    super(database, [
      { name: "id", sqlType: "TEXT", constraints: "PRIMARY KEY COLLATE NOCASE" },
      { name: "value", sqlType: "TEXT", constraints: "NOT NULL" },
    ]);
  }
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
    test("native excerpts preserve the old rows, raw scores, filters, limits and ordering", () => {
      const database = open(driver);
      const notes = new Notes(database, {
        fts: { columns: ["title", "body"], weights: [5, 1], maintenance: "triggers" },
      });
      notes.initialize();
      for (const note of [
        { id: "b", title: "café", body: "orchard orchard", category: "one" },
        { id: "a", title: "café orchard", body: "orchard", category: "one" },
        { id: "c", title: "café", body: "orchard", category: "two" },
      ])
        notes.create(note);
      const fts = notes.ftsIndex!;
      for (const query of ["orchard", "cafe", "cafe cafe", "cafe orchard", "--- ***", "absent"]) {
        for (const filter of [undefined, Filter.eq("category", "one"), Filter.in("category", [])]) {
          for (const limit of [1, 10]) {
            const old = fts.searchRows(query, filter, limit);
            const projected = fts.searchRowsWithExcerpt(query, filter, limit);
            expect(projected.map(({ excerpt: _excerpt, ...match }) => match)).toEqual(old);
            expect(fts.search(query, filter, limit)).toEqual(
              old.map((match) => ({ id: match.row.id, rank: match.lexical_score })),
            );
            for (const match of old)
              expect(Object.keys(match).sort()).toEqual(["lexical_score", "row"]);
            for (const match of projected) expect(match.excerpt.length).toBeGreaterThan(0);
          }
        }
      }
    });

    test("trigger and extractor maintenance keep native excerpts current", () => {
      const database = open(driver);
      const notes = new Notes(database, {
        fts: { columns: ["title", "body"], maintenance: "triggers" },
      });
      notes.initialize();
      notes.create({ id: "a", title: "titleonly", body: "bodyonly", category: "one" });
      const fts = notes.ftsIndex!;
      expect(fts.searchRowsWithExcerpt("titleonly")[0]!.excerpt).toContain("titleonly");
      expect(fts.searchRowsWithExcerpt("bodyonly")[0]!.excerpt).toContain("bodyonly");
      notes.update("a", { body: "replacement" });
      expect(fts.searchRowsWithExcerpt("bodyonly")).toEqual([]);
      expect(fts.searchRowsWithExcerpt("replacement")[0]!.excerpt).toContain("replacement");
      notes.delete("a");
      expect(fts.searchRowsWithExcerpt("replacement")).toEqual([]);

      const extracted = new Notes(database, {
        fts: {
          indexName: "extracted_fts",
          columns: ["search_text"],
          extractor: (row) => ({ search_text: row.body }),
        },
      });
      extracted.initialize();
      extracted.create({ id: "b", title: "other", body: "extractedneedle", category: "one" });
      expect(extracted.ftsIndex!.searchRowsWithExcerpt("extractedneedle")[0]!.excerpt).toContain(
        "extractedneedle",
      );
      extracted.update("b", { body: "freshneedle" });
      expect(extracted.ftsIndex!.searchRowsWithExcerpt("extractedneedle")).toEqual([]);
      expect(extracted.ftsIndex!.searchRowsWithExcerpt("freshneedle")[0]!.excerpt).toContain(
        "freshneedle",
      );
    });

    test("source excerpt fields and a retained reserved alias cannot shadow native evidence", () => {
      const database = open(driver);
      class ExcerptNotes extends IndexedTable<{ id: string; excerpt: string; body: string }> {
        readonly tableName = "excerpt_notes";
        constructor() {
          super(
            database,
            [
              { name: "excerpt", sqlType: "TEXT" },
              { name: "body", sqlType: "TEXT" },
            ],
            {
              fts: { columns: ["body"], maintenance: "triggers" },
            },
          );
        }
      }
      const notes = new ExcerptNotes();
      notes.initialize();
      database.raw.exec(
        `ALTER TABLE excerpt_notes ADD COLUMN "fts excerpt" TEXT DEFAULT 'spoofed'`,
      );
      notes.create({ id: "a", excerpt: "source value", body: "needle" });
      const fts = notes.ftsIndex!;
      const result = fts.searchRowsWithExcerpt("needle")[0]!;
      expect(result.excerpt).toContain("needle");
      expect(result.row.excerpt).toBe("source value");
      expect(result.row).toEqual(notes.read("a")!);
      expect(result.row).not.toHaveProperty("fts excerpt");
      expect(result.lexical_score).toBe(fts.searchRows("needle")[0]!.lexical_score);
    });

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
      expect(result.map((match) => match.row.object_key)).toEqual(["a", "b"]);
      expect(result[0]!.chunk_index).toBe(1);
      expect(result[0]!.distance).toBeLessThan(result[1]!.distance);
      expect(
        vectors
          .searchRows(new Float32Array([1, 0]), { fingerprint: "model:b" })
          .map((match) => match.row.object_key),
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

    test("FTS ranking metadata never overwrites a colliding source column", () => {
      const database = open(driver);
      const notes = new CollidingNotes(database, {
        fts: { columns: ["title", "body"], maintenance: "triggers" },
      });
      notes.initialize();
      notes.create({
        id: "best",
        title: "orchard",
        body: "orchard orchard orchard",
        lexical_score: new Date("2026-02-01T00:00:00.000Z"),
        distance: 1,
        chunk_index: 1,
      });
      notes.create({
        id: "worst",
        title: "orchard",
        body: "orchard",
        lexical_score: new Date("2026-01-01T00:00:00.000Z"),
        distance: 2,
        chunk_index: 2,
      });
      const index = notes.ftsIndex!;
      // The true BM25 order, measured with an alias that no source column can occupy.
      const measured = database.raw
        .prepare(
          `SELECT m."id" AS "document", bm25("colliding_notes_fts", 0.0, 1.0, 1.0) AS "bm25 score"
           FROM (SELECT * FROM "colliding_notes" m) m
           JOIN "colliding_notes_fts" ON m."id" = "colliding_notes_fts"."id"
           WHERE "colliding_notes_fts" MATCH ? ORDER BY "bm25 score" ASC`,
        )
        .all('"orchard"') as { document: string }[];
      expect(measured.map((row) => row.document)).toEqual(["best", "worst"]);
      // The colliding source column sorts the other way, so an ordering regression cannot pass.
      const bySourceColumn = database.raw
        .prepare(`SELECT "id" FROM "colliding_notes" ORDER BY "lexical_score" ASC`)
        .all() as { id: string }[];
      expect(bySourceColumn.map((row) => row.id)).toEqual(["worst", "best"]);

      const results = index.searchRows("orchard");
      expect(results.map((match) => match.row.id)).toEqual(["best", "worst"]);
      expect(index.searchRows("orchard", undefined, 1)[0]!.row.id).toBe("best");
      // The source keeps its own column values; the ranking is reported separately.
      expect(results[0]!.row.lexical_score).toEqual(new Date("2026-02-01T00:00:00.000Z"));
      expect(typeof results[0]!.lexical_score).toBe("number");
      // The ranking keeps the raw BM25 meaning, where smaller values rank first.
      expect(results[0]!.lexical_score).toBeLessThan(0);
      expect(results[1]!.lexical_score).toBeGreaterThan(results[0]!.lexical_score);
      expect(results[0]!.row.distance).toBe(1);
      expect(results[0]!.row.chunk_index).toBe(1);
    });

    test("FTS ranking ignores a retained source column named like the internal score alias", () => {
      const database = open(driver);
      const notes = new Notes(database, {
        fts: { columns: ["title", "body"], maintenance: "triggers" },
      });
      notes.initialize();
      notes.create({
        id: "best",
        title: "orchard",
        body: "orchard orchard orchard",
        category: "one",
      });
      notes.create({ id: "worst", title: "orchard", body: "orchard", category: "one" });
      // A compatible migration retains extra columns, and this one carries the internal alias name.
      database.raw.exec(`ALTER TABLE "notes" ADD COLUMN "fts lexical score" TEXT`);
      // The retained column sorts the other way, so an ordering regression cannot pass.
      database.raw
        .prepare(`UPDATE "notes" SET "fts lexical score" = ? WHERE id = ?`)
        .run("Z", "best");
      database.raw
        .prepare(`UPDATE "notes" SET "fts lexical score" = ? WHERE id = ?`)
        .run("A", "worst");

      // The true BM25 order, measured with an alias that no source column can occupy.
      const measured = database.raw
        .prepare(
          `SELECT m."id" AS "document", bm25("notes_fts", 0.0, 1.0, 1.0) AS "bm25 score"
           FROM (SELECT * FROM "notes" m) m
           JOIN "notes_fts" ON m."id" = "notes_fts"."id"
           WHERE "notes_fts" MATCH ? ORDER BY "bm25 score" ASC`,
        )
        .all('"orchard"') as { document: string; "bm25 score": number }[];
      expect(measured.map((row) => row.document)).toEqual(["best", "worst"]);

      const index = notes.ftsIndex!;
      const results = index.searchRows("orchard");
      expect(results.map((match) => match.row.id)).toEqual(measured.map((row) => row.document));
      expect(results.map((match) => match.lexical_score)).toEqual(
        measured.map((row) => row["bm25 score"]),
      );
      expect(index.searchRows("orchard", undefined, 1)[0]!.row.id).toBe(measured[0]!.document);
    });

    test("FTS initialization refuses a pre-existing index with a different content model", () => {
      const contentless = open(driver);
      contentless.raw.exec(
        `CREATE VIRTUAL TABLE "notes_fts" USING fts5("id" UNINDEXED, "title", "body", tokenize = 'unicode61 remove_diacritics 2', content = '')`,
      );
      expect(() =>
        new Notes(contentless, { fts: { columns: ["title", "body"] } }).initialize(),
      ).toThrow("migration or rebuild");

      const external = open(driver);
      external.raw.exec(
        `CREATE VIRTUAL TABLE "notes_fts" USING fts5("id" UNINDEXED, "title", "body", tokenize = 'unicode61 remove_diacritics 2', content = 'notes')`,
      );
      expect(() =>
        new Notes(external, { fts: { columns: ["title", "body"] } }).initialize(),
      ).toThrow("migration or rebuild");

      const unindexed = open(driver);
      unindexed.raw.exec(
        `CREATE VIRTUAL TABLE "notes_fts" USING fts5("id" UNINDEXED, "title" UNINDEXED, "body", tokenize = 'unicode61 remove_diacritics 2')`,
      );
      expect(() =>
        new Notes(unindexed, { fts: { columns: ["title", "body"] } }).initialize(),
      ).toThrow("migration or rebuild");

      // An ordinary default index keeps the content in the index itself and stays usable.
      const ordinary = open(driver);
      ordinary.raw.exec(
        `CREATE VIRTUAL TABLE "notes_fts" USING fts5("id" UNINDEXED, "title", "body", tokenize = 'unicode61 remove_diacritics 2')`,
      );
      const notes = new Notes(ordinary, {
        fts: { columns: ["title", "body"], maintenance: "triggers" },
      });
      notes.initialize();
      notes.create({ id: "a", title: "orchard", body: "orchard", category: "one" });
      expect(notes.searchFTS("orchard").map((row) => row.id)).toEqual(["a"]);
    });

    test("vector ranking metadata never overwrites a colliding source column", () => {
      const database = open(driver);
      const documents = new VectorDocuments(database);
      documents.initialize();
      const vectors = new VectorIndex(documents, {
        sourceKey: "id",
        freshness: {
          checksum: "checksum",
          fingerprint: "embedding_fingerprint",
          dimensions: "embedding_dimensions",
          embeddingChecksum: "embedding_checksum",
        },
      });
      vectors.initialize();
      documents.create({
        id: "a",
        body: "orchard",
        checksum: "sum-a",
        embedding_fingerprint: "model:a",
        embedding_dimensions: 2,
        embedding_checksum: "sum-a",
        distance: 7,
        chunk_index: 3,
      });
      vectors.replaceSync("a", vectors.prepareChunks(chunks("orchard", [1, 0])), {
        checksum: "sum-a",
        fingerprint: "model:a",
      });
      const results = vectors.searchRows(new Float32Array([1, 0]), { fingerprint: "model:a" });
      expect(results).toHaveLength(1);
      expect(results[0]!.row.distance).toBe(7);
      expect(results[0]!.row.chunk_index).toBe(3);
      expect(results[0]!.distance).toBe(0);
      expect(results[0]!.chunk_index).toBe(0);
      expect(results[0]!.chunk_text).toBe("orchard");
    });

    test("direct vector insertion publishes the configured freshness markers", async () => {
      const database = open(driver);
      const documents = new VectorDocuments(database);
      documents.initialize();
      const vectors = new VectorIndex(documents, {
        sourceKey: "id",
        fingerprint: "model:a",
        extractor: (row) => row.body,
        embedder: () => Promise.resolve(new Float32Array([1, 0])),
        freshness: {
          checksum: "checksum",
          fingerprint: "embedding_fingerprint",
          dimensions: "embedding_dimensions",
          embeddingChecksum: "embedding_checksum",
        },
      });
      vectors.initialize();
      documents.create({
        id: "a",
        body: "orchard",
        checksum: "sum-a",
        embedding_fingerprint: "model:a",
        embedding_dimensions: 2,
        embedding_checksum: "sum-a",
      });
      await vectors.insertRow(documents.readSync("a")!);
      // The markers are published next to the vectors, so the semantic search finds the row.
      const hits = vectors.searchRows(new Float32Array([1, 0]));
      expect(hits.map((match) => match.row.id)).toEqual(["a"]);
      expect(hits[0]!.distance).toBe(0);
      const published = documents.readSync("a")!;
      const stored = vectors.storage.readAll();
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.every((row) => row.fingerprint === published.embedding_fingerprint)).toBe(true);
      expect(stored.every((row) => row.dimensions === published.embedding_dimensions)).toBe(true);
      expect(published.embedding_checksum).toBe("sum-a");
      expect(published.checksum).toBe("sum-a");
    });

    test("revision identity follows the collation of the source key column", async () => {
      const database = open(driver);
      const table = new CaseInsensitiveKeys(database);
      table.initialize();
      table.create({ id: "A", value: "one" });
      // Every spelling that resolves to the row shares one revision.
      expect(table.revisions.read("a")).toBe(table.revisions.read("A"));
      expect(table.revisions.read("a")).toBeGreaterThan(0);
      const preparation = await table.prepareUpdate("a", { value: "two" });
      // A concurrent write to the stored spelling has to invalidate the preparation.
      table.updateSync("A", { value: "three" });
      expect(() => preparation.commit()).toThrow(MutationConflictError);
      expect(table.readSync("A")?.value).toBe("three");
      // A deletion keeps its tombstone visible to every spelling of the identity.
      table.deleteSync("A");
      expect(table.revisions.read("a")).toBeGreaterThan(0);
      expect(table.readSync("a")).toBeUndefined();
      // A recreation under another spelling advances the same revision.
      table.create({ id: "a", value: "four" });
      expect(table.revisions.read("A")).toBeGreaterThan(0);
    });

    test("a revision table written with binary comparison migrates to the source collation", () => {
      const database = open(driver);
      const table = new CaseInsensitiveKeys(database);
      table.initialize();
      table.create({ id: "A", value: "one" });
      // Stand in for a revision table written by an older version, which compared binary.
      database.raw.exec(`DROP TABLE "case_keys_mutation_revisions"`);
      database.raw.exec(
        `CREATE TABLE "case_keys_mutation_revisions" (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)`,
      );
      database.raw
        .prepare(`INSERT INTO "case_keys_mutation_revisions" (id, revision) VALUES (?, ?)`)
        .run("A", 3);
      table.revisions.initialize();
      // The migration keeps the recorded revision and adopts the source comparison.
      expect(table.revisions.read("A")).toBe(3);
      expect(table.revisions.read("a")).toBe(3);
      // The recreated triggers still advance the migrated revision.
      table.updateSync("A", { value: "two" });
      expect(table.revisions.read("a")).toBe(4);
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
