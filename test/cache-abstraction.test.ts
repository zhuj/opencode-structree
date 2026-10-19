import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/lib/config.ts";
import { openDatabase } from "../src/lib/sqlite/driver.ts";
import { SqliteIndex } from "../src/lib/sqlite/index.ts";
import type { FrameworkConfig, SourceDocument } from "../src/lib/types.ts";

const directories: string[] = [];
const connections: { close(): unknown }[] = [];
const v2Schema = readFileSync(new URL("./fixtures/cache-v2.sql", import.meta.url), "utf8");

afterEach(() => {
  for (const connection of connections.splice(0).reverse()) connection.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function config(driver: FrameworkConfig["sqlite"]["driver"]): FrameworkConfig["sqlite"] {
  const directory = mkdtempSync(join(tmpdir(), "object-mcp-cache-v2-"));
  directories.push(directory);
  return { ...defaultConfig.sqlite, path: join(directory, "index.sqlite"), driver };
}

function source(id: string, text: string): SourceDocument {
  const object = {
    id,
    name: id,
    title: text,
    description: "Original-cache fixture",
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
    updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    retiredAt: null,
    tags: {},
    metadata: {},
  };
  const raw = `---\nid: ${id}\n---\n${text}`;
  return {
    type: "project",
    key: JSON.stringify(["project", id]),
    object,
    body: text,
    raw,
    json: {
      ...object,
      createdAt: object.createdAt.toISOString(),
      updatedAt: object.updatedAt.toISOString(),
    },
    path: `projects/${id}.md`,
    checksum: createHash("sha256").update(raw).digest("hex"),
  };
}

for (const driver of ["better-sqlite3", "bun"] as const) {
  describe(`Cache abstraction compatibility (${driver})`, () => {
    test("opens the original v2 schema, retains cached vectors, and repairs missing/duplicate FTS rows", () => {
      const sqlite = config(driver);
      const original = openDatabase(sqlite);
      const documents = [source("a", "orchard apples"), source("b", "orchard pears")];
      try {
        original.exec(v2Schema);
        for (const document of documents) {
          original
            .prepare(`INSERT INTO object_meta(object_key, object_type, id, name, title, path,
            checksum, json, raw, body, embedding_fingerprint, embedding_checksum, embedding_dimensions, embedding_chunks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 1)`)
            .run(
              document.key,
              document.type,
              document.object.id,
              document.object.name,
              document.object.title,
              document.path,
              document.checksum,
              JSON.stringify(document.json),
              document.raw,
              document.body,
              "fixture-space",
              document.checksum,
            );
          const vector = Buffer.alloc(8);
          vector.writeFloatLE(1, 0);
          original
            .prepare(`INSERT INTO embeddings(object_key, chunk_index, checksum, fingerprint,
            dimensions, start_offset, end_offset, chunk_text, vector) VALUES (?, 0, ?, ?, 2, 0, ?, ?, ?)`)
            .run(
              document.key,
              document.checksum,
              "fixture-space",
              Array.from(document.raw).length,
              document.raw,
              vector,
            );
        }
        original.exec("UPDATE cache_state SET generation = 7 WHERE singleton = 1");
        original.prepare("DELETE FROM object_fts WHERE object_key = ?").run(documents[0]!.key);
        original
          .prepare("INSERT INTO object_fts SELECT * FROM object_fts WHERE object_key = ?")
          .run(documents[1]!.key);
      } finally {
        original.close();
      }

      const index = new SqliteIndex(sqlite, defaultConfig.search);
      connections.push(index);
      expect(index.status("fixture-space")).toMatchObject({
        objects: 2,
        embeddedObjects: 2,
        embeddingRows: 2,
        generation: 7,
      });
      expect(index.search({ query: "orchard", mode: "fulltext", topN: 10 }).hits).toHaveLength(2);
      expect(
        index
          .search(
            { query: "fruit", mode: "semantic", topN: 2 },
            new Float32Array([1, 0]),
            "fixture-space",
          )
          .hits.map((hit) => hit.id),
      ).toEqual(["a", "b"]);
      for (const document of documents) {
        expect(index.needsEmbeddings(document.key, document.checksum, "fixture-space")).toBe(false);
        expect(index.getMetadata(document.key)?.raw).toBe(document.raw);
        expect(index.upsertDocument(document)).toBe(false);
      }
      expect(index.status().generation).toBe(7);
      expect(index.removeKeys([documents[0]!.key])).toBe(1);
      expect(
        index.search({ query: "orchard", mode: "fulltext" }).hits.map((hit) => hit.id),
      ).toEqual(["b"]);
      expect(index.status().embeddingRows).toBe(1);
      index.close();

      const reopened = new SqliteIndex(sqlite, defaultConfig.search);
      connections.push(reopened);
      expect(reopened.status("fixture-space")).toMatchObject({
        objects: 1,
        embeddedObjects: 1,
        embeddingRows: 1,
        generation: 8,
      });
    });

    test("refuses to claim an unrelated nonempty database without changing its data or schema", () => {
      const sqlite = config(driver);
      const unrelated = openDatabase(sqlite);
      connections.push(unrelated);
      unrelated.exec("CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT NOT NULL)");
      unrelated.prepare("INSERT INTO notes VALUES (?, ?)").run("keep", "user-owned notes");

      expect(() => new SqliteIndex(sqlite, defaultConfig.search)).toThrow("unclaimed database");
      expect(unrelated.prepare("SELECT * FROM notes").all()).toEqual([
        { id: "keep", body: "user-owned notes" },
      ]);
      expect(unrelated.prepare("PRAGMA application_id").get()).toEqual({ application_id: 0 });
      expect(
        unrelated.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(),
      ).toEqual([{ name: "notes" }]);
    });

    test("refuses a cache from an unsupported version without dropping fields", () => {
      const sqlite = config(driver);
      const old = openDatabase(sqlite);
      connections.push(old);
      old.exec(
        "CREATE TABLE old_objects(id TEXT PRIMARY KEY, extra TEXT); PRAGMA application_id = 1330463568; PRAGMA user_version = 1;",
      );
      old.prepare("INSERT INTO old_objects VALUES (?, ?)").run("keep", "future migration input");
      expect(() => new SqliteIndex(sqlite, defaultConfig.search)).toThrow(
        "Unsupported object index schema 1",
      );
      expect(old.prepare("SELECT * FROM old_objects").all()).toEqual([
        { id: "keep", extra: "future migration input" },
      ]);
      expect(old.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    });
  });
}
