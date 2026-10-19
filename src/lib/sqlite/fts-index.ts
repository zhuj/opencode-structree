import { quoteIdentifier, validateBindings, type WhereFilter } from "./filter.ts";
import type { Table } from "./table.ts";

export interface FTSIndexOptions<Row extends object> {
  readonly columns: readonly string[];
  readonly affects?: (updates: Partial<Row>) => boolean;
  readonly extractor?: (row: Row) => Readonly<Record<string, string>>;
  readonly sourceKey?: string;
  readonly indexKey?: string;
  readonly indexName?: string;
  readonly weights?: readonly number[];
  readonly tokenizer?: "unicode61 remove_diacritics 2" | "porter unicode61" | "unicode61";
  /** Triggers are suitable when each indexed column comes directly from its source column. */
  readonly maintenance?: "manual" | "triggers";
  readonly triggerPrefix?: string;
  readonly orderBy?: readonly string[];
}

export interface FTSResult {
  readonly id: string;
  /** Raw BM25 score, where smaller values rank first; this is not an ordinal rank. */
  readonly rank: number;
}

export type FTSRow<Row extends object> = Row & { readonly lexical_score: number };

/** FTS stores the original text. Only MATCH expressions receive literal-query escaping. */
export class FTSIndex<Row extends object> {
  readonly sourceKey: string;
  readonly indexKey: string;

  constructor(
    readonly table: Table<Row>,
    readonly options: FTSIndexOptions<Row>,
  ) {
    this.sourceKey = options.sourceKey ?? table.primaryKey[0] ?? "id";
    this.indexKey = options.indexKey ?? this.sourceKey;
    for (const name of [
      this.sourceKey,
      this.indexKey,
      ...(options.indexName === undefined ? [] : [options.indexName]),
      ...options.columns,
    ])
      quoteIdentifier(name);
    if (
      options.columns.length === 0 ||
      new Set(options.columns).size !== options.columns.length ||
      options.columns.includes(this.indexKey)
    ) {
      throw new TypeError(
        "FTS columns must be nonempty, unique, and different from the identity column.",
      );
    }
    this.assertSourceColumn(this.sourceKey);
    if (table.primaryKey.length !== 1 || table.primaryKey[0] !== this.sourceKey) {
      throw new TypeError("An FTS source table needs a single, encoded document key.");
    }
    for (const name of options.orderBy ?? []) this.assertSourceColumn(name);
    if (
      options.weights !== undefined &&
      (options.weights.length !== options.columns.length ||
        options.weights.some((weight) => !Number.isFinite(weight) || weight < 0))
    ) {
      throw new TypeError(
        "FTS weights must contain one finite, nonnegative value per indexed column.",
      );
    }
    if (options.maintenance === "triggers") {
      if (options.extractor !== undefined)
        throw new TypeError(
          "Trigger-maintained FTS requires direct source columns; use manual maintenance for an extractor.",
        );
      for (const name of options.columns) this.assertSourceColumn(name);
    }
  }

  // Concrete Table fields are assigned after its superclass constructs the index helpers.
  get tableName(): string {
    return this.options.indexName ?? `${this.table.tableName}_fts`;
  }

  initialize(): void {
    const raw = this.table.db.raw;
    const name = quoteIdentifier(this.tableName);
    const indexKey = quoteIdentifier(this.indexKey);
    const fields = this.options.columns.map(quoteIdentifier).join(", ");
    const tokenizer = this.options.tokenizer ?? "unicode61 remove_diacritics 2";
    if (!["unicode61 remove_diacritics 2", "porter unicode61", "unicode61"].includes(tokenizer)) {
      throw new TypeError("Unsupported FTS tokenizer.");
    }
    raw
      .transaction(() => {
        const existing = raw
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(this.tableName) as { sql: string } | null | undefined;
        if (existing != null) {
          const columns = raw.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
          const expected = [this.indexKey, ...this.options.columns];
          const configuredTokenizer =
            existing.sql
              .match(/tokenize\s*=\s*(['"])(.*?)\1/i)?.[2]
              ?.replace(/\s+/g, " ")
              .trim() ?? "unicode61";
          if (
            !/\bUSING\s+fts5\s*\(/i.test(existing.sql) ||
            columns.length !== expected.length ||
            columns.some((column, index) => column.name !== expected[index]) ||
            configuredTokenizer !== tokenizer
          ) {
            throw new Error(
              `FTS index ${this.tableName} differs from its configured columns or tokenizer; an explicit index migration or rebuild is required.`,
            );
          }
        }
        raw.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING fts5(${indexKey} UNINDEXED, ${fields}, tokenize = '${tokenizer}')`,
        );
        if (this.options.maintenance === "triggers") this.initializeTriggers();
        // Initialization also repairs missing/duplicate identities left by an interrupted older writer.
        const source = quoteIdentifier(this.table.tableName);
        const sourceKey = quoteIdentifier(this.sourceKey);
        raw.exec(
          `DELETE FROM ${name} WHERE ${indexKey} NOT IN (SELECT ${sourceKey} FROM ${source})`,
        );
        const rows = raw
          .prepare(`SELECT m.* FROM ${source} m LEFT JOIN ${name} f ON f.${indexKey} = m.${sourceKey}
        GROUP BY m.${sourceKey} HAVING COUNT(f.${indexKey}) != 1`)
          .all() as Record<string, unknown>[];
        for (const rawRow of rows) {
          const row = this.table.materialize(rawRow);
          if (row !== undefined) this.replaceSync(this.rowKey(row), this.prepareRow(row));
        }
      })
      .immediate();
  }

  needsUpdate(updates: Partial<Row>): boolean {
    if (this.options.affects !== undefined) return this.options.affects(updates);
    if (this.options.extractor !== undefined) return Object.keys(updates).length > 0;
    return this.options.columns.some((column) => Object.hasOwn(updates, column));
  }

  prepareRow(row: Row): readonly string[] {
    const data = this.options.extractor?.(row) ?? row;
    return this.options.columns.map((column) => {
      const value: unknown = Reflect.get(data, column);
      if (typeof value !== "string") throw new TypeError(`FTS column ${column} must contain text.`);
      return value;
    });
  }

  insertRow(row: Row): void {
    this.replaceSync(this.rowKey(row), this.prepareRow(row));
  }

  insert(id: string, data: Readonly<Record<string, string>>): void {
    const values = this.options.columns.map((column) => {
      const value = data[column];
      if (value === undefined) throw new TypeError(`FTS column ${column} is missing.`);
      return value;
    });
    this.replaceSync(id, values);
  }

  replaceSync(id: string, values: readonly string[]): void {
    if (
      values.length !== this.options.columns.length ||
      values.some((value) => typeof value !== "string")
    ) {
      throw new TypeError("Prepared FTS values must contain one string per indexed column.");
    }
    this.table.db.raw.transaction(() => {
      this.deleteSync(id);
      const columns = [this.indexKey, ...this.options.columns].map(quoteIdentifier);
      this.table.db.raw
        .prepare(
          `INSERT INTO ${quoteIdentifier(this.tableName)} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        )
        .run(id, ...values);
    })();
  }

  delete(id: string): void {
    this.deleteSync(id);
  }

  deleteSync(id: string): void {
    this.table.db.raw
      .prepare(
        `DELETE FROM ${quoteIdentifier(this.tableName)} WHERE ${quoteIdentifier(this.indexKey)} = ?`,
      )
      .run(id);
  }

  searchRows(query: string, filter?: WhereFilter, limit = 10): FTSRow<Row>[] {
    validateLimit(limit);
    const expression = literalFtsQuery(query);
    if (expression === undefined) return [];
    const values = filter?.values ?? [];
    validateBindings(values);
    const where = filter?.clause.trim() ? `WHERE ${filter.clause}` : "";
    const name = quoteIdentifier(this.tableName);
    const weights = this.options.weights ?? this.options.columns.map(() => 1);
    const order = [...new Set([...(this.options.orderBy ?? []), this.sourceKey])]
      .map((column) => `m.${quoteIdentifier(column)} ASC`)
      .join(", ");
    // The subquery keeps unqualified filters in the source-table namespace, including its key.
    const rows = this.table.db.raw
      .prepare(`SELECT m.*, bm25(${name}, 0.0, ${weights.join(", ")}) AS lexical_score
      FROM (SELECT * FROM ${quoteIdentifier(this.table.tableName)} m ${where}) m
      JOIN ${name} ON m.${quoteIdentifier(this.sourceKey)} = ${name}.${quoteIdentifier(this.indexKey)}
      WHERE ${name} MATCH ? ORDER BY lexical_score ASC, ${order} LIMIT ?`)
      .all(...values, expression, limit) as Record<string, unknown>[];
    return rows.map((rawRow) => {
      const row = this.table.materialize(rawRow);
      if (row === undefined) throw new Error("A matched FTS source row could not be materialized.");
      return { ...row, lexical_score: Number(rawRow.lexical_score) };
    });
  }

  search(query: string, filter?: WhereFilter, limit = 10): FTSResult[] {
    return this.searchRows(query, filter, limit).map((row) => ({
      id: this.rowKey(row),
      rank: row.lexical_score,
    }));
  }

  private initializeTriggers(): void {
    const source = quoteIdentifier(this.table.tableName);
    const name = quoteIdentifier(this.tableName);
    const sourceKey = quoteIdentifier(this.sourceKey);
    const indexKey = quoteIdentifier(this.indexKey);
    const prefix = this.options.triggerPrefix ?? `${this.tableName}_source`;
    const columns = this.options.columns.map(quoteIdentifier);
    const insert = `INSERT INTO ${name}(${indexKey}, ${columns.join(", ")}) VALUES (new.${sourceKey}, ${columns.map((column) => `new.${column}`).join(", ")});`;
    this.table.db.raw.exec(`
      CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(`${prefix}_insert`)} AFTER INSERT ON ${source} BEGIN ${insert} END;
      CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(`${prefix}_delete`)} AFTER DELETE ON ${source} BEGIN
        DELETE FROM ${name} WHERE ${indexKey} = old.${sourceKey}; END;
      DROP TRIGGER IF EXISTS ${quoteIdentifier(`${prefix}_update`)};
      DROP TRIGGER IF EXISTS ${quoteIdentifier(`${prefix}_move`)};
      CREATE TRIGGER ${quoteIdentifier(`${prefix}_update`)} AFTER UPDATE OF ${[...new Set([sourceKey, ...columns])].join(", ")} ON ${source} BEGIN
        DELETE FROM ${name} WHERE ${indexKey} = old.${sourceKey};
        DELETE FROM ${name} WHERE ${indexKey} = new.${sourceKey}; ${insert} END;
    `);
  }

  private rowKey(row: Row): string {
    const key: unknown = Reflect.get(row, this.sourceKey);
    if (typeof key !== "string") throw new TypeError("FTS source identities must be strings.");
    return key;
  }

  private assertSourceColumn(column: string): void {
    quoteIdentifier(column);
    if (!this.table.columnNames.includes(column))
      throw new TypeError(`Unknown FTS source column ${column}.`);
  }
}

/** Treat operators, punctuation, and column selectors as literal Unicode tokens joined by AND. */
export function literalFtsQuery(query: string): string | undefined {
  const tokens = [...new Set(query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])];
  if (tokens.length === 0) return undefined;
  if (tokens.length > 128) throw new Error("Full-text search accepts at most 128 distinct tokens.");
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

export function escapeFTSQuery(query: string): string {
  return literalFtsQuery(query) ?? "";
}

export function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Search limit must be a positive integer.");
}
