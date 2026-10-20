import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import {
  type Column,
  columnsFromEffect,
  dateConverter,
  jsonArrayConverter,
  jsonObjectConverter,
} from "../src/lib/sqlite/column.ts";
import { Database, type DatabaseConfig } from "../src/lib/sqlite/database.ts";
import { MutationConflictError, SchemaMigrationError } from "../src/lib/sqlite/errors.ts";
import { Filter, MAX_FILTER_BINDINGS, quoteIdentifier } from "../src/lib/sqlite/filter.ts";
import { Migrator } from "../src/lib/sqlite/migrator.ts";
import { type MutationCommitHook, MutationRevisions } from "../src/lib/sqlite/prepared-mutation.ts";
import { Table, type TableOptions } from "../src/lib/sqlite/table.ts";

const openDatabases: Database[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class NamedTable<Row extends object> extends Table<Row> {
  constructor(
    database: Database,
    readonly tableName: string,
    columns: readonly Column[],
    options?: TableOptions,
  ) {
    super(database, columns, options);
  }
}

const ItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  amount: Schema.Finite,
  active: Schema.Boolean,
  created: Schema.Date,
  retired: Schema.NullOr(Schema.Date),
  labels: Schema.Array(Schema.String),
  details: Schema.Record(Schema.String, Schema.String),
  note: Schema.optionalKey(Schema.String),
});
type Item = typeof ItemSchema.Type;

class ItemDatabase extends Database {
  readonly items: NamedTable<Item>;
  constructor(config: DatabaseConfig) {
    super(config);
    this.items = this.register(
      (database) => new NamedTable<Item>(database, "items", columnsFromEffect(ItemSchema)),
    );
  }
}

function open(driver: DatabaseConfig["driver"], path = ":memory:"): ItemDatabase {
  const database = new ItemDatabase({ driver, path, busyTimeoutMs: 1000 });
  openDatabases.push(database);
  database.initialize();
  return database;
}

/** The raised error, or undefined when the action succeeded. */
function captureError(action: () => unknown): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}

function item(id = "fixed-id", name = "alpha"): Item {
  return {
    id,
    name,
    amount: 3.5,
    active: true,
    created: new Date("2026-10-15T00:00:00.000Z"),
    retired: null,
    labels: ["a", "b"],
    details: { color: "green" },
  };
}

for (const driver of ["better-sqlite3", "bun"] as const) {
  describe(`Database and table abstractions (${driver})`, () => {
    test("Effect column codecs preserve Dates, booleans, optional keys and supplied IDs", () => {
      const database = open(driver);
      const row = item();
      expect(database.items.create(row)).toEqual(row);
      expect(database.items.read(row.id)).toEqual(row);
      expect(database.items.read("missing")).toBeUndefined();
      expect(database.items.read(row.id)).not.toHaveProperty("note");
      const raw = database.raw
        .prepare("SELECT active, created, labels, details, retired FROM items WHERE id = ?")
        .get(row.id);
      expect(raw).toEqual({
        active: 1,
        created: row.created.toISOString(),
        labels: '["a","b"]',
        details: '{"color":"green"}',
        retired: null,
      });
      database.items.update(row.id, { note: "hello", active: false });
      expect(database.items.read(row.id)).toMatchObject({ note: "hello", active: false });
      expect(() => database.items.update(row.id, { id: "changed" })).toThrow("cannot be changed");
      expect(database.items.upsert(row.id, { name: "beta" })).toBe(false);
      expect(() => database.items.upsert(row.id, {}, false)).toThrow("already exists");
      const { id: _id, ...withoutId } = item();
      const generated = database.items.create(withoutId);
      expect(generated.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(database.items.delete(row.id)).toBe(true);
      expect(database.items.delete(row.id)).toBe(false);
      expect(() =>
        database.items.create({ ...item(), active: "yes" } as unknown as Item),
      ).toThrow();
      expect(() => database.items.create({ ...item(), created: new Date("invalid") })).toThrow();
      database.initialize();
      expect(database.items.read(generated.id)).toEqual(generated);
    });

    test("null converter output is not undone by serialization", () => {
      const database = open(driver);
      const table = new NamedTable<{ id: string; value: string | null }>(
        database,
        "nullable_conversion",
        [
          {
            name: "value",
            sqlType: "TEXT",
            converter: { toDB: () => null, fromDB: (value) => value },
          },
        ],
      );
      table.initialize();
      expect(table.create({ id: "n", value: "discard" })).toEqual({ id: "n", value: null });
      expect(table.serialize({ value: "discard" })).toEqual({ value: null });
      const permissive = Schema.Struct({ id: Schema.String, value: Schema.Unknown });
      const unknownTable = new NamedTable<{ id: string; value: unknown }>(
        database,
        "unknown_values",
        columnsFromEffect(permissive),
      );
      unknownTable.initialize();
      expect(unknownTable.create({ id: "null", value: null })).toEqual({ id: "null", value: null });
    });

    test("bound filters handle null, empty membership, qualified columns, and offset without limit", () => {
      const database = open(driver);
      database.items.create(item("a", "alpha"));
      database.items.create({ ...item("b", "beta"), note: "present" });
      database.items.create(item("c", "gamma"));
      expect(
        database.items.readAll(undefined, { orderBy: "id ASC", offset: 1 }).map((row) => row.id),
      ).toEqual(["b", "c"]);
      expect(
        database.items.readAll(Filter.and(Filter.empty(), Filter.eq("items.retired", null))).length,
      ).toBe(3);
      expect(database.items.readAll(Filter.in("note", [null, "present"]))).toHaveLength(3);
      expect(database.items.readAll(Filter.in("id", []))).toEqual([]);
      expect(
        database.items.readAll(Filter.jsonIn("details", "$.color", ["green", null])),
      ).toHaveLength(3);
      expect(database.items.readAll(Filter.jsonEq("details", "$.missing", null))).toHaveLength(3);
      expect(database.items.readAll(Filter.eq("name", "' OR 1=1 --"))).toEqual([]);
      expect(database.items.readAll(Filter.or(Filter.empty(), Filter.eq("id", "a")))).toHaveLength(
        1,
      );
      expect(() => database.items.readAll(undefined, { orderBy: "id; DROP TABLE items" })).toThrow(
        "Invalid orderBy",
      );
      expect(() => database.items.readAll(undefined, { limit: -1 })).toThrow("nonnegative");
      expect(() => database.items.readAll(undefined, { offset: 0.2 })).toThrow("nonnegative");
      expect(() => Filter.eq("id); DROP TABLE items; --", "a")).toThrow("Invalid SQL identifier");
      expect(() =>
        Filter.in(
          "id",
          Array.from({ length: MAX_FILTER_BINDINGS + 1 }, () => "a"),
        ),
      ).toThrow("at most");
      expect(() => Filter.eq("amount", Number.NaN)).toThrow("finite numbers");
      expect(database.items.readAll()).toHaveLength(3);
    });

    test("composite primary keys work without inventing an id column, with source-row delete counts", () => {
      const database = open(driver);
      const table = new NamedTable<{ owner: string; part: number; value: string }>(
        database,
        "parts",
        [
          { name: "owner", sqlType: "TEXT", constraints: "NOT NULL" },
          { name: "part", sqlType: "INTEGER", constraints: "NOT NULL CHECK (part >= 0)" },
          { name: "value", sqlType: "TEXT", constraints: "NOT NULL" },
        ],
        { primaryKey: ["owner", "part"], withoutRowid: true },
      );
      table.initialize();
      expect(table.columnNames).toEqual(["owner", "part", "value"]);
      table.create({ owner: "object", part: 0, value: "whole" });
      table.create({ owner: "object", part: 1, value: "chunk" });
      expect(table.read({ owner: "object", part: 1 })?.value).toBe("chunk");
      expect(table.upsert(["object", 1], { value: "updated" })).toBe(false);
      expect(table.read(["object", 1])?.value).toBe("updated");
      database.raw.exec(
        "CREATE TABLE deleted_parts (value TEXT); CREATE TRIGGER record_part_delete AFTER DELETE ON parts BEGIN INSERT INTO deleted_parts VALUES (old.value); INSERT INTO deleted_parts VALUES (old.value); END",
      );
      expect(table.delete(["object", 0])).toBe(true);
      expect(table.delete(["object", 0])).toBe(false);
      expect(database.raw.prepare("SELECT COUNT(*) AS n FROM deleted_parts").get()).toEqual({
        n: 2,
      });
      expect(() => table.read(["object"])).toThrow("Expected 2");
      expect(() => table.create({ owner: "object", part: -1, value: "bad" })).toThrow();
    });

    test("additive migrations preserve extra columns and reject incompatible schemas atomically", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      const columns: Column[] = [
        { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "value", sqlType: "INTEGER", constraints: "NOT NULL DEFAULT 1 CHECK (value > 0)" },
        { name: "legacy", sqlType: "TEXT" },
      ];
      expect(migrator.sync("migration_test", columns)).toEqual(['created table "migration_test"']);
      database.raw.exec("INSERT INTO migration_test(id, legacy) VALUES ('first', 'retained')");
      expect(migrator.sync("migration_test", columns.slice(0, 2))).toEqual([]);
      expect(database.raw.prepare("SELECT legacy FROM migration_test").get()).toEqual({
        legacy: "retained",
      });
      expect(
        migrator.sync("migration_test", [...columns, { name: "optional", sqlType: "TEXT" }]),
      ).toEqual(['added column "optional"']);
      expect(() =>
        migrator.sync("migration_test", [
          ...columns,
          { name: "rolled_back", sqlType: "TEXT" },
          { name: "required", sqlType: "TEXT", constraints: "NOT NULL" },
        ]),
      ).toThrow(SchemaMigrationError);
      expect(
        database.raw
          .prepare("PRAGMA table_info(migration_test)")
          .all()
          .map((row) => (row as { name: string }).name),
      ).not.toContain("rolled_back");
      expect(() =>
        migrator.sync(
          "migration_test",
          columns.map((column) =>
            column.name === "value" ? { ...column, sqlType: "REAL" } : column,
          ),
        ),
      ).toThrow("incompatible type");
      expect(() =>
        migrator.sync(
          "migration_test",
          columns.map((column) =>
            column.name === "value"
              ? { ...column, constraints: "NOT NULL DEFAULT 1 CHECK (value >= 0)" }
              : column,
          ),
        ),
      ).toThrow("CHECK constraints differ");
      expect(database.raw.prepare("SELECT value FROM migration_test").get()).toEqual({ value: 1 });
    });

    test("migrations refuse a pre-existing UNIQUE constraint with a non-default conflict policy", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      database.raw.exec(
        "CREATE TABLE replace_unique (id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL UNIQUE ON CONFLICT REPLACE)",
      );
      database.raw.exec("INSERT INTO replace_unique(id, code) VALUES ('first', 'shared')");
      const columns: Column[] = [
        { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "code", sqlType: "TEXT", constraints: "NOT NULL UNIQUE" },
        { name: "note", sqlType: "TEXT" },
      ];
      expect(() => migrator.sync("replace_unique", columns)).toThrow(SchemaMigrationError);
      expect(() => migrator.sync("replace_unique", columns)).toThrow("ON CONFLICT REPLACE");
      // The refused migration leaves the stored rows and the declared schema unchanged.
      expect(database.raw.prepare("SELECT id, code FROM replace_unique").all()).toEqual([
        { id: "first", code: "shared" },
      ]);
      expect(
        database.raw
          .prepare("PRAGMA table_info(replace_unique)")
          .all()
          .map((row) => (row as { name: string }).name),
      ).toEqual(["id", "code"]);
      expect(
        database.raw.prepare("SELECT sql FROM sqlite_schema WHERE name = 'replace_unique'").get(),
      ).toEqual({
        sql: "CREATE TABLE replace_unique (id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL UNIQUE ON CONFLICT REPLACE)",
      });
      // A table constraint carries the same policy, so it is refused as well.
      database.raw.exec(
        "CREATE TABLE replace_pair (id TEXT NOT NULL PRIMARY KEY, a TEXT, b TEXT, UNIQUE(a, b) ON CONFLICT REPLACE)",
      );
      expect(() =>
        migrator.sync("replace_pair", [
          { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
          { name: "a", sqlType: "TEXT" },
          { name: "b", sqlType: "TEXT" },
        ]),
      ).toThrow("ON CONFLICT REPLACE");
    });

    test("migrations refuse a requested UNIQUE constraint with a non-default conflict policy", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      expect(() =>
        migrator.sync("requested_replace", [
          { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
          { name: "code", sqlType: "TEXT", constraints: "NOT NULL UNIQUE ON CONFLICT REPLACE" },
        ]),
      ).toThrow("ON CONFLICT REPLACE");
      expect(
        database.raw
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'requested_replace'")
          .get() ?? null,
      ).toBeNull();
    });

    test("migrations refuse a UNIQUE conflict policy that a SQL comment hides", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      const columns: Column[] = [
        { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "code", sqlType: "TEXT", constraints: "NOT NULL UNIQUE" },
      ];
      database.raw.exec(
        "CREATE TABLE commented_replace (id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL UNIQUE /* policy */ ON CONFLICT REPLACE)",
      );
      database.raw.exec("INSERT INTO commented_replace(id, code) VALUES ('first', 'shared')");
      // The refusal is the safeguard: while it is missing the application keeps writing to a
      // table whose conflict policy deletes a stored row, so the damage is reproduced first.
      const refusal = captureError(() => migrator.sync("commented_replace", columns));
      if (refusal === undefined) {
        database.raw.exec("INSERT INTO commented_replace(id, code) VALUES ('second', 'shared')");
      }
      expect(database.raw.prepare("SELECT id, code FROM commented_replace").all()).toEqual([
        { id: "first", code: "shared" },
      ]);
      expect(refusal).toBeInstanceOf(SchemaMigrationError);
      expect(String(refusal)).toContain("ON CONFLICT REPLACE");
      // A comment placed before the policy hides it in the same way.
      database.raw.exec(
        "CREATE TABLE commented_replace_before (id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL UNIQUE ON /* policy */ CONFLICT REPLACE)",
      );
      expect(() => migrator.sync("commented_replace_before", columns)).toThrow(
        "ON CONFLICT REPLACE",
      );
      // A line comment hides it as well, and it ends at the end of its line.
      database.raw.exec(
        "CREATE TABLE commented_replace_line (id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL UNIQUE -- policy\nON CONFLICT REPLACE)",
      );
      expect(() => migrator.sync("commented_replace_line", columns)).toThrow("ON CONFLICT REPLACE");
      // A table constraint carries the same policy.
      database.raw.exec(
        "CREATE TABLE commented_replace_pair (id TEXT NOT NULL PRIMARY KEY, a TEXT, b TEXT, UNIQUE(a, b) /* policy */ ON CONFLICT REPLACE)",
      );
      expect(() =>
        migrator.sync("commented_replace_pair", [
          { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
          { name: "a", sqlType: "TEXT" },
          { name: "b", sqlType: "TEXT" },
        ]),
      ).toThrow("ON CONFLICT REPLACE");
      // A requested layout with a hidden policy is refused before the table is created.
      expect(() =>
        migrator.sync("requested_commented_replace", [
          { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
          {
            name: "code",
            sqlType: "TEXT",
            constraints: "NOT NULL UNIQUE /* policy */ ON CONFLICT REPLACE",
          },
        ]),
      ).toThrow("ON CONFLICT REPLACE");
      expect(
        database.raw
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'requested_commented_replace'")
          .get() ?? null,
      ).toBeNull();
      // A plain UNIQUE keeps the implicit ABORT policy and stays acceptable.
      database.raw.exec(
        "CREATE TABLE plain_unique (id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL UNIQUE)",
      );
      expect(migrator.sync("plain_unique", columns)).toEqual([]);
    });

    test("SQL comments do not change the compared table shape", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      database.raw.exec("CREATE TABLE owners (id TEXT NOT NULL PRIMARY KEY)");
      database.raw.exec(
        "CREATE TABLE commented_shape (\n" +
          "  id TEXT NOT NULL PRIMARY KEY, -- the key\n" +
          "  code TEXT NOT NULL UNIQUE /* the code */,\n" +
          "  name TEXT NOT NULL COLLATE /* note */ NOCASE,\n" +
          "  amount INTEGER NOT NULL DEFAULT 1 CHECK (amount >= 0 /* note */),\n" +
          "  total INTEGER GENERATED ALWAYS AS (amount /* note */ + 1) VIRTUAL,\n" +
          "  owner TEXT /* note */ REFERENCES owners(id)\n" +
          ")",
      );
      const columns: Column[] = [
        { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "code", sqlType: "TEXT", constraints: "NOT NULL UNIQUE" },
        { name: "name", sqlType: "TEXT", constraints: "NOT NULL COLLATE NOCASE" },
        {
          name: "amount",
          sqlType: "INTEGER",
          constraints: "NOT NULL DEFAULT 1 CHECK (amount >= 0)",
        },
        {
          name: "total",
          sqlType: "INTEGER",
          constraints: "GENERATED ALWAYS AS (amount + 1) VIRTUAL",
        },
        { name: "owner", sqlType: "TEXT", constraints: "REFERENCES owners(id)" },
      ];
      expect(migrator.sync("commented_shape", columns)).toEqual([]);
      // A real difference is still refused.
      expect(() =>
        migrator.sync(
          "commented_shape",
          columns.map((column) =>
            column.name === "amount"
              ? { ...column, constraints: "NOT NULL DEFAULT 1 CHECK (amount > 0)" }
              : column,
          ),
        ),
      ).toThrow("CHECK constraints differ");
      // A string literal that looks like a comment keeps its content.
      database.raw.exec(
        "CREATE TABLE commented_literal (id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL DEFAULT 'a /* b */')",
      );
      expect(
        migrator.sync("commented_literal", [
          { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
          { name: "code", sqlType: "TEXT", constraints: "NOT NULL DEFAULT 'a /* b */'" },
        ]),
      ).toEqual([]);
    });

    test("an unterminated SQL comment is refused as a migration error", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      const refusal = captureError(() =>
        migrator.sync("unterminated_comment", [
          { name: "id", sqlType: "TEXT", constraints: "NOT NULL /* unterminated" },
        ]),
      );
      expect(refusal).toBeInstanceOf(SchemaMigrationError);
      expect(String(refusal)).toContain("unterminated comment");
      expect(
        database.raw
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'unterminated_comment'")
          .get() ?? null,
      ).toBeNull();
    });

    test("migrations accept an identical generated column expression and refuse a changed one", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      database.raw.exec(
        "CREATE TABLE generated_values (id TEXT NOT NULL PRIMARY KEY, x INTEGER NOT NULL, y INTEGER GENERATED ALWAYS AS (x + 1) VIRTUAL)",
      );
      database.raw.exec("INSERT INTO generated_values(id, x) VALUES ('first', 1)");
      const base: Column[] = [
        { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "x", sqlType: "INTEGER", constraints: "NOT NULL" },
      ];
      expect(
        migrator.sync("generated_values", [
          ...base,
          { name: "y", sqlType: "INTEGER", constraints: "GENERATED ALWAYS AS (x + 1) VIRTUAL" },
        ]),
      ).toEqual([]);
      expect(() =>
        migrator.sync("generated_values", [
          ...base,
          { name: "y", sqlType: "INTEGER", constraints: "GENERATED ALWAYS AS (x + 2) VIRTUAL" },
          { name: "note", sqlType: "TEXT" },
        ]),
      ).toThrow("incompatible generation expression");
      // The refused migration is atomic: the pending column and every stored row survive.
      expect(
        database.raw
          .prepare("PRAGMA table_info(generated_values)")
          .all()
          .map((row) => (row as { name: string }).name),
      ).not.toContain("note");
      expect(database.raw.prepare("SELECT id, x, y FROM generated_values").all()).toEqual([
        { id: "first", x: 1, y: 2 },
      ]);
    });

    test("initialization rolls back all registered DDL and closes on failure", () => {
      const root = mkdtempSync(join(tmpdir(), "object-mcp-db-init-"));
      roots.push(root);
      const path = join(root, "failed.sqlite");
      class FailingDatabase extends ItemDatabase {
        protected override initializeSchema(): void {
          super.initializeSchema();
          throw new Error("deliberate setup failure");
        }
      }
      const failing = new FailingDatabase({ path, driver, busyTimeoutMs: 1000 });
      openDatabases.push(failing);
      expect(() => failing.initialize()).toThrow("deliberate setup failure");
      expect(() => failing.raw).toThrow("closed");
      const reopened = new Database({ path, driver, busyTimeoutMs: 1000 });
      openDatabases.push(reopened);
      expect(
        reopened.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'items'").get() ?? null,
      ).toBeNull();
    });

    test("migration validation distinguishes partial uniqueness, collation, and primary-key configuration", () => {
      const database = open(driver);
      const migrator = new Migrator(database);
      database.raw.exec(
        "CREATE TABLE partial_unique (id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL, active INTEGER NOT NULL); CREATE UNIQUE INDEX partial_title ON partial_unique(title) WHERE active = 1",
      );
      const columns: Column[] = [
        { name: "id", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "title", sqlType: "TEXT", constraints: "NOT NULL UNIQUE" },
        { name: "active", sqlType: "INTEGER", constraints: "NOT NULL" },
      ];
      expect(() => migrator.sync("partial_unique", columns)).toThrow("unique constraints differ");
      database.raw.exec(
        "CREATE TABLE wrong_collation (id TEXT NOT NULL PRIMARY KEY COLLATE NOCASE, title TEXT NOT NULL, active INTEGER NOT NULL)",
      );
      expect(() =>
        migrator.sync(
          "wrong_collation",
          columns.map((column) =>
            column.name === "title" ? { ...column, constraints: "NOT NULL" } : column,
          ),
        ),
      ).toThrow("COLLATE");
      expect(() =>
        migrator.sync(
          "wrong_key",
          [
            { name: "id", sqlType: "TEXT", constraints: "PRIMARY KEY" },
            { name: "owner", sqlType: "TEXT" },
          ],
          { primaryKey: "owner" },
        ),
      ).toThrow("disagree");
      expect(
        database.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'wrong_key'").get() ??
          null,
      ).toBeNull();
    });

    test("persistent prepared revisions detect external writes, delete/recreate ABA, and key moves", () => {
      const root = mkdtempSync(join(tmpdir(), "object-mcp-db-revisions-"));
      roots.push(root);
      const path = join(root, "shared.sqlite");
      const first = open(driver, path);
      const second = open(driver, path);
      const revisions = new MutationRevisions(first, "items");
      revisions.initialize();
      first.items.create(item("same"));
      const snapshot = revisions.read("same");
      const stale = revisions.prepare({ id: "same", revision: snapshot }, () =>
        first.items.update("same", { name: "stale" }),
      );
      second.items.delete("same");
      second.items.create(item("same"));
      expect(revisions.read("same")).toBeGreaterThan(snapshot);
      expect(() => stale.commit()).toThrow(MutationConflictError);
      expect(first.items.read("same")?.name).toBe("alpha");

      const oldRevision = revisions.read("same");
      const move = revisions.prepare({ id: "same", revision: oldRevision }, () =>
        first.items.update("same", { name: "lost" }),
      );
      second.raw.prepare("UPDATE items SET id = ? WHERE id = ?").run("moved", "same");
      expect(revisions.read("same")).toBeGreaterThan(oldRevision);
      expect(revisions.read("moved")).toBeGreaterThan(0);
      expect(() => move.commit()).toThrow(MutationConflictError);
    });

    test("prepared commits are single-use; throwing hooks roll back rows and revisions before retry", () => {
      const database = open(driver);
      const revisions = new MutationRevisions(database, "items");
      revisions.initialize();
      database.items.create(item("hook"));
      const revision = revisions.read("hook");
      const prepared = revisions.prepare({ id: "hook", revision }, () => {
        database.items.update("hook", { name: "committed" });
        return "done";
      });
      expect(() =>
        prepared.commit(() => {
          throw new Error("hook failed");
        }),
      ).toThrow("hook failed");
      expect(database.items.read("hook")?.name).toBe("alpha");
      expect(revisions.read("hook")).toBe(revision);
      const asyncHook = (async () => undefined) as unknown as MutationCommitHook<string>;
      expect(() => prepared.commit(asyncHook)).toThrow("must be synchronous");
      expect(revisions.read("hook")).toBe(revision);
      expect(prepared.commit()).toBe("done");
      expect(database.items.read("hook")?.name).toBe("committed");
      expect(() => prepared.commit()).toThrow(MutationConflictError);
      const thenable = revisions.prepare({ id: "hook", revision: revisions.read("hook") }, () => {
        database.items.update("hook", { name: "rolled back" });
        return Promise.resolve("not synchronous");
      });
      expect(() => thenable.commit()).toThrow("must not return a promise");
      expect(database.items.read("hook")?.name).toBe("committed");
    });

    test("REGEXP capability is available only when the driver supports function registration", () => {
      const database = open(driver);
      expect(database.regexpAvailable).toBe(driver === "better-sqlite3");
      if (!database.regexpAvailable) return;
      database.items.create(item());
      expect(database.items.readAll(Filter.regex("name", "^alp"))).toHaveLength(1);
      expect(database.items.readAll(Filter.regex("name", "["))).toEqual([]);
      expect(database.items.readAll(Filter.regex("name", "(a+)+$"))).toEqual([]);
    });
  });
}

test("standalone converters fail on malformed stored values", () => {
  expect(() => jsonObjectConverter.fromDB('{"broken":')).toThrow();
  expect(() => jsonArrayConverter.fromDB("{}")).toThrow("array");
  expect(() => dateConverter.fromDB("invalid-date")).toThrow("Invalid date");
  expect(jsonObjectConverter.fromDB(null)).toBeNull();
  expect(() => quoteIdentifier('name"; DROP TABLE items; --')).toThrow("Invalid SQL identifier");
});
