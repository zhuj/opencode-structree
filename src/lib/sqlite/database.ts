import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getLoadablePath } from "sqlite-vec";
import { FrameworkConfigSchema } from "../config.ts";
import type { FrameworkConfig } from "../types.ts";
import { openDatabase, type SqlDatabase } from "./driver.ts";
import { RegexpFunction } from "./regexp-function.ts";
import type { Table } from "./table.ts";

export const DatabaseConfigSchema = FrameworkConfigSchema.fields.sqlite;
export type DatabaseConfig = FrameworkConfig["sqlite"];

export interface DatabaseOptions {
  readonly loadVectorExtension?: boolean;
  /** Omitted means best effort; true requires a driver with JavaScript function registration. */
  readonly registerRegexp?: boolean;
}

/** One connection owns registered tables. All lifecycle and SQL work is synchronous. */
export class Database {
  protected readonly db: SqlDatabase;
  protected readonly tables: Table<object>[] = [];
  private initialized = false;
  private closed = false;
  regexpAvailable = false;

  constructor(
    protected readonly config: DatabaseConfig,
    private readonly options: DatabaseOptions = {},
  ) {
    if (!Number.isSafeInteger(config.busyTimeoutMs) || config.busyTimeoutMs < 0)
      throw new RangeError("busyTimeoutMs must be a nonnegative safe integer.");
    if (config.path !== ":memory:") mkdirSync(dirname(config.path), { recursive: true });
    // Opening has no schema side effects; subclasses can check cache ownership before initialize().
    this.db = openDatabase(config);
  }

  protected register<T extends Table<object>>(factory: (database: Database) => T): T {
    this.assertOpen();
    if (this.initialized) throw new Error("Register tables before initializing the database.");
    const table = factory(this);
    if (table.db !== this) throw new Error("A registered table must use this database connection.");
    if (this.tables.some((current) => current.tableName === table.tableName))
      throw new Error(`Table ${table.tableName} is already registered.`);
    this.tables.push(table);
    return table;
  }

  protected loadExtensions(): void {
    if (this.options.loadVectorExtension === true)
      this.db.loadExtension(this.config.extensionPath ?? getLoadablePath());
  }

  initialize(): void {
    this.assertOpen();
    if (this.initialized) return;
    try {
      this.db.exec(
        `PRAGMA busy_timeout = ${this.config.busyTimeoutMs}; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`,
      );
      this.loadExtensions();
      if (this.options.registerRegexp !== false)
        this.regexpAvailable = new RegexpFunction().register(this.db);
      if (this.options.registerRegexp === true && !this.regexpAvailable)
        throw new Error("The selected SQLite driver does not support JavaScript REGEXP functions.");
      // DDL, repair triggers, and subclass version markers publish together or roll back together.
      this.db.transaction(() => this.initializeSchema()).immediate();
      this.initialized = true;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  protected initializeSchema(): void {
    for (const table of this.tables) table.initialize();
  }

  get raw(): SqlDatabase {
    this.assertOpen();
    return this.db;
  }

  assertOpen(): void {
    if (this.closed) throw new Error("The SQLite database is closed.");
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  shutdown(): void {
    this.close();
  }
}
