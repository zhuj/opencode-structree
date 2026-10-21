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

/**
 * The source row and the ranking metadata occupy separate namespaces. A source column may
 * legally be named like a ranking field, so the ranking is never merged into the source row.
 */
export interface FTSRow<Row extends object> {
  readonly row: Row;
  /** Raw BM25 score, where smaller values rank first; this is not an ordinal rank. */
  readonly lexical_score: number;
}

/** Native lexical evidence, without source coordinates or column attribution. */
export interface FTSExcerptRow<Row extends object> extends FTSRow<Row> {
  readonly excerpt: string;
}

/**
 * The ranking is projected under an alias containing a space. Declared source columns are plain
 * SQL identifiers, so no declared column can occupy this alias, and the projection names the
 * declared columns explicitly, which keeps a retained extra column out of the result set.
 */
const SCORE_KEY = "fts lexical score";
const EXCERPT_KEY = "fts excerpt";

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
          const layout = fts5Layout(existing.sql);
          if (
            layout === undefined ||
            columns.length !== expected.length ||
            columns.some((column, index) => column.name !== expected[index]) ||
            fts5Tokenizer(layout.options) !== tokenizer ||
            !isDefaultContentModel(layout, expected.length)
          ) {
            throw new Error(
              `FTS index ${this.tableName} differs from its configured columns, tokenizer, or content model; an explicit index migration or rebuild is required.`,
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
    return this.searchProjectedRows(query, filter, limit, false);
  }

  searchRowsWithExcerpt(query: string, filter?: WhereFilter, limit = 10): FTSExcerptRow<Row>[] {
    return this.searchProjectedRows(query, filter, limit, true);
  }

  private searchProjectedRows(
    query: string,
    filter: WhereFilter | undefined,
    limit: number,
    excerpt: false,
  ): FTSRow<Row>[];
  private searchProjectedRows(
    query: string,
    filter: WhereFilter | undefined,
    limit: number,
    excerpt: true,
  ): FTSExcerptRow<Row>[];
  private searchProjectedRows(
    query: string,
    filter: WhereFilter | undefined,
    limit: number,
    excerpt: boolean,
  ): FTSRow<Row>[] | FTSExcerptRow<Row>[] {
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
    // The projection names the declared columns, so a retained extra column cannot join the
    // result set and shadow the score that the order is computed from.
    const projection = this.table.columnNames
      .map((column) => `m.${quoteIdentifier(column)}`)
      .join(", ");
    const excerptProjection = excerpt
      ? `, snippet(${name}, -1, '', '', '...', 32) AS "${EXCERPT_KEY}"`
      : "";
    const rows = this.table.db.raw
      .prepare(`SELECT ${projection}, bm25(${name}, 0.0, ${weights.join(", ")}) AS "${SCORE_KEY}"${excerptProjection}
      FROM (SELECT * FROM ${quoteIdentifier(this.table.tableName)} m ${where}) m
      JOIN ${name} ON m.${quoteIdentifier(this.sourceKey)} = ${name}.${quoteIdentifier(this.indexKey)}
      WHERE ${name} MATCH ? ORDER BY "${SCORE_KEY}" ASC, ${order} LIMIT ?`)
      .all(...values, expression, limit) as Record<string, unknown>[];
    return rows.map((rawRow) => {
      const row = this.table.materialize(rawRow);
      if (row === undefined) throw new Error("A matched FTS source row could not be materialized.");
      const match = { row, lexical_score: Number(rawRow[SCORE_KEY]) };
      if (!excerpt) return match;
      const text = rawRow[EXCERPT_KEY];
      if (typeof text !== "string") throw new Error("A matched FTS excerpt must contain text.");
      return { ...match, excerpt: text };
    });
  }

  search(query: string, filter?: WhereFilter, limit = 10): FTSResult[] {
    return this.searchRows(query, filter, limit).map((match) => ({
      id: this.rowKey(match.row),
      rank: match.lexical_score,
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
  // This self-imposed bound counts distinct extracted tokens before SQLite folding, not a SQLite limit: FTS5 was measured on 2026-10-21 executing 2000 AND-joined and 5000 OR-joined terms without error on SQLite 3.53.4. Exceeding the cap fails rather than truncates; the failure surfaces as INTERNAL per docs/decisions/0008-search-query-and-availability-guidance.md.
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

/** The layout an FTS5 table declares: its columns, their indexing, and its options. */
interface FtsLayout {
  readonly columns: readonly FtsColumn[];
  readonly options: ReadonlyMap<string, string>;
}

interface FtsColumn {
  readonly name: string;
  readonly unindexed: boolean;
}

/**
 * The default content model keeps the indexed text in the FTS table itself, indexes every
 * indexed field, and configures nothing beyond the tokenizer. A contentless table, a table with
 * externally stored content, and an unindexed indexed field all need an explicit rebuild.
 */
function isDefaultContentModel(layout: FtsLayout, columnCount: number): boolean {
  if (layout.columns.length !== columnCount) return false;
  // The identity column may be indexed or unindexed; every indexed field has to be indexed.
  if (layout.columns.slice(1).some((column) => column.unindexed)) return false;
  return [...layout.options.keys()].every((option) => option === "tokenize");
}

/** The layout declared by a CREATE VIRTUAL TABLE statement, or undefined when it is unreadable. */
function fts5Layout(sql: string): FtsLayout | undefined {
  const arguments_ = fts5Arguments(sql);
  if (arguments_ === undefined) return undefined;
  const columns: FtsColumn[] = [];
  const options = new Map<string, string>();
  for (const argument of arguments_) {
    const trimmed = argument.trim();
    if (trimmed === "") continue;
    const separator = fts5OptionSeparator(trimmed);
    if (separator !== undefined) {
      options.set(
        trimmed.slice(0, separator).trim().toLowerCase(),
        trimmed.slice(separator + 1).trim(),
      );
      continue;
    }
    const column = fts5Column(trimmed);
    if (column === undefined) return undefined;
    columns.push(column);
  }
  return { columns, options };
}

/** The fts5 arguments of a CREATE VIRTUAL TABLE statement, or undefined when they are unreadable. */
function fts5Arguments(sql: string): string[] | undefined {
  const using = /\bUSING\s+fts5\s*\(/i.exec(sql);
  if (using === null) return undefined;
  const arguments_: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;
  for (let index = using.index + using[0].length; index < sql.length; index += 1) {
    const character = sql.charAt(index);
    if (quote !== undefined) {
      current += character;
      if (character === quote) {
        if (sql.charAt(index + 1) === quote) {
          current += sql.charAt(index + 1);
          index += 1;
          continue;
        }
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }
    if (character === ")") {
      if (depth === 0) {
        arguments_.push(current);
        return arguments_;
      }
      depth -= 1;
      current += character;
      continue;
    }
    if (character === "," && depth === 0) {
      arguments_.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  return undefined;
}

/** The position of the "=" that separates an FTS5 option from its value. */
function fts5OptionSeparator(argument: string): number | undefined {
  let quote: string | undefined;
  for (let index = 0; index < argument.length; index += 1) {
    const character = argument.charAt(index);
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "=") {
      const name = argument.slice(0, index).trim();
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? index : undefined;
    }
  }
  return undefined;
}

/** A column of an FTS5 table, with the indexing that its declaration requests. */
function fts5Column(argument: string): FtsColumn | undefined {
  const quote = argument.charAt(0);
  if (quote === '"' || quote === "'" || quote === "`") {
    let name = "";
    let index = 1;
    while (index < argument.length) {
      const character = argument.charAt(index);
      if (character === quote) {
        if (argument.charAt(index + 1) === quote) {
          name += quote;
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      name += character;
      index += 1;
    }
    return { name, unindexed: fts5Modifiers(argument.slice(index)).includes("UNINDEXED") };
  }
  const parts = argument.split(/\s+/).filter((part) => part !== "");
  const name = parts[0];
  if (name === undefined) return undefined;
  return { name, unindexed: fts5Modifiers(parts.slice(1).join(" ")).includes("UNINDEXED") };
}

/** The modifiers of an FTS5 column declaration. */
function fts5Modifiers(modifiers: string): string[] {
  return modifiers
    .split(/\s+/)
    .filter((modifier) => modifier !== "")
    .map((modifier) => modifier.toUpperCase());
}

/** The tokenizer in effect, where an absent option means the SQLite default. */
function fts5Tokenizer(options: ReadonlyMap<string, string>): string {
  const value = options.get("tokenize");
  if (value === undefined) return "unicode61";
  return unquote(value).replace(/\s+/g, " ").trim();
}

/** The text of a quoted option value. */
function unquote(value: string): string {
  const quote = value.charAt(0);
  if ((quote === "'" || quote === '"') && value.length > 1 && value.endsWith(quote))
    return value.slice(1, -1).replaceAll(`${quote}${quote}`, quote);
  return value;
}
