import { randomUUID } from "node:crypto";
import type { Column } from "./column.ts";
import type { Database } from "./database.ts";
import type { SqlStatement, SqlValue } from "./driver.ts";
import { ColumnListEmptyError, DuplicateIdError, InvalidOrderError } from "./errors.ts";
import { assertSqlValue, quoteIdentifier, validateBindings, type WhereFilter } from "./filter.ts";
import { Migrator, type TableSchemaOptions } from "./migrator.ts";

export type TableKey = SqlValue | readonly SqlValue[] | Readonly<Record<string, SqlValue>>;
export type TableOptions = TableSchemaOptions;

export interface ReadAllOpts {
  readonly orderBy?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** Synchronous CRUD remains safe inside the caller's transaction; embedding preparation belongs outside it. */
export abstract class Table<Row extends object> {
  abstract readonly tableName: string;
  readonly dataColumns: readonly Column[];
  readonly primaryKey: readonly string[];
  protected selectClause = "";
  private selectByPkStmt: SqlStatement | undefined;
  private deleteByPkStmt: SqlStatement | undefined;
  private insertStmt: SqlStatement | undefined;
  private initialized = false;

  protected constructor(
    readonly db: Database,
    columns: readonly Column[],
    private readonly options: TableOptions = {},
  ) {
    this.primaryKey =
      typeof options.primaryKey === "string"
        ? [options.primaryKey]
        : [...(options.primaryKey ?? ["id"])];
    if (this.primaryKey.length === 0 || new Set(this.primaryKey).size !== this.primaryKey.length)
      throw new TypeError("A table needs one or more distinct primary-key columns.");
    const all = [...columns];
    if (options.primaryKey === undefined && !all.some((column) => column.name === "id"))
      all.unshift({ name: "id", sqlType: "TEXT", constraints: "NOT NULL" });
    if (all.length === 0) throw new ColumnListEmptyError();
    for (const column of all) quoteIdentifier(column.name);
    if (new Set(all.map((column) => column.name)).size !== all.length)
      throw new TypeError("Column names must be unique.");
    for (const key of this.primaryKey) {
      quoteIdentifier(key);
      if (!all.some((column) => column.name === key))
        throw new TypeError(`Primary-key column ${key} is not defined.`);
    }
    this.dataColumns = all;
  }

  get columnNames(): string[] {
    return this.dataColumns.map((column) => column.name);
  }

  protected convert(row: Record<string, unknown>): Row {
    return row as Row;
  }

  initialize(): void {
    this.db.assertOpen();
    if (this.initialized) return;
    quoteIdentifier(this.tableName);
    new Migrator(this.db).sync(this.tableName, this.dataColumns, {
      ...this.options,
      primaryKey: this.primaryKey,
    });
    const columns = this.columnNames.map(quoteIdentifier).join(", ");
    const where = this.primaryKey.map((key) => `${quoteIdentifier(key)} = ?`).join(" AND ");
    this.selectClause = `SELECT ${columns} FROM ${quoteIdentifier(this.tableName)}`;
    this.selectByPkStmt = this.db.raw.prepare(`${this.selectClause} WHERE ${where}`);
    this.deleteByPkStmt = this.db.raw.prepare(
      `DELETE FROM ${quoteIdentifier(this.tableName)} WHERE ${where} RETURNING ${this.primaryKey.map(quoteIdentifier).join(", ")}`,
    );
    this.insertStmt = this.db.raw.prepare(
      `INSERT INTO ${quoteIdentifier(this.tableName)} (${columns}) VALUES (${this.dataColumns.map(() => "?").join(", ")})`,
    );
    this.initialized = true;
  }

  protected buildRow(raw: Record<string, unknown>): Row {
    const row: Record<string, unknown> = {};
    for (const column of this.dataColumns)
      if (Object.hasOwn(raw, column.name)) row[column.name] = raw[column.name];
    if (this.primaryKey.length === 1 && this.primaryKey[0] === "id" && !Object.hasOwn(row, "id"))
      row.id = randomUUID();
    return this.convert(row);
  }

  keyValues(key: TableKey): SqlValue[] {
    const values = Array.isArray(key)
      ? key
      : key !== null && typeof key === "object" && !(key instanceof Uint8Array)
        ? this.primaryKey.map((name) => (key as Readonly<Record<string, SqlValue>>)[name])
        : [key];
    if (values.length !== this.primaryKey.length)
      throw new TypeError(`Expected ${this.primaryKey.length} primary-key values.`);
    return values.map((value) => {
      if (value === null) throw new TypeError("Primary-key values cannot be null.");
      return assertSqlValue(value);
    });
  }

  keyOf(row: Row): TableKey {
    const values = this.primaryKey.map((name) =>
      assertSqlValue((row as Record<string, unknown>)[name]),
    );
    const first = values[0];
    if (values.length === 1 && first !== undefined) return first;
    return values;
  }

  materialize(raw: Record<string, unknown> | null | undefined): Row | undefined {
    if (raw == null) return undefined;
    const row: Record<string, unknown> = {};
    for (const column of this.dataColumns) {
      if (!Object.hasOwn(raw, column.name)) continue;
      const value =
        column.converter === undefined
          ? raw[column.name]
          : column.converter.fromDB(raw[column.name]);
      if (value !== undefined) row[column.name] = value;
    }
    return this.convert(row);
  }

  serialize(row: Partial<Row> | null | undefined): Record<string, SqlValue> | undefined {
    if (row == null) return undefined;
    const serialized: Record<string, SqlValue> = {};
    for (const column of this.dataColumns) {
      if (!Object.hasOwn(row, column.name)) continue;
      const value = (row as Record<string, unknown>)[column.name];
      // A converter may intentionally return null; nullish fallback would silently undo it.
      serialized[column.name] = assertSqlValue(
        column.converter === undefined ? value : column.converter.toDB(value),
      );
    }
    return serialized;
  }

  create(raw: Partial<Row>): Row {
    this.assertInitialized();
    return this.db.raw
      .transaction(() => {
        const row = this.buildRow(raw as Record<string, unknown>);
        const key = this.keyOf(row);
        this.insertSync(key, row);
        const created = this.readSync(key);
        if (created === undefined) throw new Error("The inserted row could not be read.");
        return created;
      })
      .immediate();
  }

  createSync(raw: Partial<Row>): Row {
    return this.create(raw);
  }

  insertSync(key: TableKey, row: Partial<Row>): void {
    this.assertInitialized();
    const serialized = this.serialize(row) ?? {};
    const values = this.keyValues(key);
    this.primaryKey.forEach((name, index) => {
      const value = values[index];
      if (value === undefined) throw new TypeError("A primary-key value is missing.");
      if (Object.hasOwn(serialized, name) && !sameValue(serialized[name], value))
        throw new TypeError(`Primary-key field ${name} differs from the supplied key.`);
      serialized[name] = value;
    });
    const names = this.columnNames.filter((name) => Object.hasOwn(serialized, name));
    const bound = names.map((name) => assertSqlValue(serialized[name]));
    if (names.length === this.dataColumns.length && this.insertStmt !== undefined)
      this.insertStmt.run(...bound);
    else
      this.db.raw
        .prepare(
          `INSERT INTO ${quoteIdentifier(this.tableName)} (${names.map(quoteIdentifier).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
        )
        .run(...bound);
  }

  read(key: TableKey): Row | undefined {
    return this.readSync(key);
  }

  readSync(key: TableKey): Row | undefined {
    this.assertInitialized();
    const statement = this.selectByPkStmt;
    if (statement === undefined) throw new Error("Table statements are not initialized.");
    return this.materialize(
      statement.get(...this.keyValues(key)) as Record<string, unknown> | undefined,
    );
  }

  readAll(filter?: WhereFilter, options: ReadAllOpts = {}): Row[] {
    this.assertInitialized();
    let sql = this.selectClause;
    const values = validateBindings(filter?.values ?? []);
    if (filter?.clause.trim()) sql += ` WHERE ${filter.clause}`;
    else if (values.length > 0) throw new TypeError("An empty filter cannot have bindings.");
    if (options.orderBy !== undefined) {
      const columns = this.columnNames;
      const parts = options.orderBy.split(",").map((part) => {
        const match = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?$/i);
        const name = match?.[1];
        if (name === undefined || !columns.includes(name))
          throw new InvalidOrderError(name ?? part, columns);
        return `${quoteIdentifier(name)} ${match?.[2]?.toUpperCase() ?? "ASC"}`;
      });
      sql += ` ORDER BY ${parts.join(", ")}`;
    }
    if (options.limit !== undefined) {
      nonnegativeInteger(options.limit, "limit");
      sql += " LIMIT ?";
      values.push(options.limit);
    } else if (options.offset !== undefined) sql += " LIMIT -1";
    if (options.offset !== undefined) {
      nonnegativeInteger(options.offset, "offset");
      sql += " OFFSET ?";
      values.push(options.offset);
    }
    return this.db.raw
      .prepare(sql)
      .all(...values)
      .map((row) => {
        const materialized = this.materialize(row as Record<string, unknown>);
        if (materialized === undefined) throw new Error("SQLite returned an absent row.");
        return materialized;
      });
  }

  readAllSync(filter?: WhereFilter, options?: ReadAllOpts): Row[] {
    return this.readAll(filter, options);
  }
  update(key: TableKey, updates: Partial<Row>): void {
    this.updateSync(key, updates);
  }

  updateSync(key: TableKey, updates: Partial<Row>): void {
    this.assertInitialized();
    const serialized = this.serialize(updates) ?? {};
    const keyValues = this.keyValues(key);
    this.primaryKey.forEach((name, index) => {
      if (Object.hasOwn(serialized, name) && !sameValue(serialized[name], keyValues[index]))
        throw new TypeError(`Primary-key field ${name} cannot be changed by update.`);
    });
    const names = this.columnNames.filter(
      (name) => !this.primaryKey.includes(name) && Object.hasOwn(serialized, name),
    );
    if (names.length === 0) return;
    this.db.raw
      .prepare(
        `UPDATE ${quoteIdentifier(this.tableName)} SET ${names.map((name) => `${quoteIdentifier(name)} = ?`).join(", ")} WHERE ${this.primaryKey.map((name) => `${quoteIdentifier(name)} = ?`).join(" AND ")}`,
      )
      .run(...names.map((name) => assertSqlValue(serialized[name])), ...keyValues);
  }

  upsert(key: TableKey, updates: Partial<Row>, overwrite = true): boolean {
    this.assertInitialized();
    return this.db.raw
      .transaction(() => {
        if (this.readSync(key) !== undefined) {
          if (!overwrite)
            throw new DuplicateIdError(
              `Row ${JSON.stringify(key)} already exists in ${this.tableName}`,
            );
          this.updateSync(key, updates);
          return false;
        }
        this.insertSync(key, updates);
        return true;
      })
      .immediate();
  }

  upsertSync(key: TableKey, updates: Partial<Row>, overwrite = true): boolean {
    return this.upsert(key, updates, overwrite);
  }
  delete(key: TableKey): boolean {
    return this.deleteSync(key);
  }

  deleteSync(key: TableKey): boolean {
    this.assertInitialized();
    const statement = this.deleteByPkStmt;
    if (statement === undefined) throw new Error("Table statements are not initialized.");
    // RETURNING counts source rows, unaffected by each driver's trigger/cascade changes convention.
    return statement.get(...this.keyValues(key)) != null;
  }

  protected assertInitialized(): void {
    this.db.assertOpen();
    if (!this.initialized) throw new Error(`Table ${this.tableName} has not been initialized.`);
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array)
    return Buffer.from(left).equals(Buffer.from(right));
  return Object.is(left, right);
}

function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer.`);
}
