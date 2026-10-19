import { randomUUID } from "node:crypto";
import type { Column } from "./column.ts";
import type { Database } from "./database.ts";
import { SchemaMigrationError } from "./errors.ts";
import { quoteIdentifier } from "./filter.ts";

export interface TableSchemaOptions {
  readonly primaryKey?: string | readonly string[];
  readonly constraints?: readonly string[];
  readonly withoutRowid?: boolean;
}

interface PragmaColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
  readonly hidden: number;
}

interface ForeignKey {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string | null;
  readonly on_update: string;
  readonly on_delete: string;
  readonly match: string;
}

/** Additive synchronization only: dropped columns, invented defaults, and implicit rebuilds lose data. */
export class Migrator {
  constructor(private readonly db: Database) {}

  sync(tableName: string, columns: readonly Column[], options: TableSchemaOptions = {}): string[] {
    quoteIdentifier(tableName);
    const desiredSql = createTableSql(tableName, columns, options);
    return this.db.raw
      .transaction(() => {
        const entry = this.db.raw
          .prepare("SELECT type, sql FROM sqlite_schema WHERE name = ?")
          .get(tableName) as { type: string; sql: string } | undefined;
        if (entry == null) {
          this.db.raw.exec(desiredSql);
          this.assertPrimaryKey(tableName, this.columns(tableName), options);
          return [`created table "${tableName}"`];
        }
        if (entry.type !== "table" || /\bCREATE\s+VIRTUAL\s+TABLE\b/i.test(entry.sql))
          throw new SchemaMigrationError(tableName, "the existing object is not a regular table");

        // Let SQLite itself interpret defaults, PK ordering, affinities, and WITHOUT ROWID nullability.
        const probe = `__object_mcp_shape_${randomUUID().replaceAll("-", "")}`;
        this.db.raw.exec(createTableSql(probe, columns, options, true));
        try {
          const desired = this.columns(probe, "temp");
          this.assertPrimaryKey(tableName, desired, options);
          let existing = this.columns(tableName);
          const actions: string[] = [];
          for (const column of columns) {
            if (existing.some((current) => current.name === column.name)) continue;
            const expected = desired.find((current) => current.name === column.name);
            if (expected === undefined)
              throw new SchemaMigrationError(
                tableName,
                `column ${column.name} could not be described`,
              );
            if (
              expected.pk > 0 ||
              (expected.notnull === 1 &&
                (expected.dflt_value === null || normalizeSql(expected.dflt_value) === "NULL"))
            ) {
              throw new SchemaMigrationError(
                tableName,
                `adding ${column.name} needs an explicit default/backfill or primary-key migration`,
              );
            }
            try {
              this.db.raw.exec(
                `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${columnSql(column)}`,
              );
            } catch (cause) {
              throw new SchemaMigrationError(tableName, `cannot add column ${column.name} safely`, {
                cause,
              });
            }
            actions.push(`added column "${column.name}"`);
          }
          existing = this.columns(tableName);
          for (const expected of desired) {
            const actual = existing.find((current) => current.name === expected.name);
            if (actual === undefined)
              throw new SchemaMigrationError(tableName, `missing column ${expected.name}`);
            for (const property of ["type", "notnull", "pk", "hidden", "dflt_value"] as const) {
              const before =
                property === "type" || property === "dflt_value"
                  ? normalizeSql(actual[property] ?? "")
                  : actual[property];
              const after =
                property === "type" || property === "dflt_value"
                  ? normalizeSql(expected[property] ?? "")
                  : expected[property];
              if (before !== after)
                throw new SchemaMigrationError(
                  tableName,
                  `${expected.name} has incompatible ${property}`,
                );
            }
          }
          const actualSql = (
            this.db.raw.prepare("SELECT sql FROM sqlite_schema WHERE name = ?").get(tableName) as {
              sql: string;
            }
          ).sql;
          const tableProperties = this.db.raw
            .prepare(`PRAGMA main.table_list(${quoteIdentifier(tableName)})`)
            .get() as { wr: number; strict: number };
          if (tableProperties.wr !== Number(options.withoutRowid === true))
            throw new SchemaMigrationError(tableName, "WITHOUT ROWID differs");
          if (tableProperties.strict !== 0)
            throw new SchemaMigrationError(
              tableName,
              "STRICT tables require an explicit schema definition",
            );
          const actualCollations = columnCollations(actualSql);
          for (const [name, collation] of columnCollations(desiredSql)) {
            if (actualCollations.get(name) !== collation)
              throw new SchemaMigrationError(tableName, `${name} has incompatible COLLATE`);
          }
          if (
            JSON.stringify(checkConstraints(actualSql)) !==
            JSON.stringify(checkConstraints(desiredSql))
          )
            throw new SchemaMigrationError(tableName, "CHECK constraints differ");
          if (
            JSON.stringify(this.foreignKeys(tableName)) !==
            JSON.stringify(this.foreignKeys(probe, "temp"))
          )
            throw new SchemaMigrationError(tableName, "foreign-key constraints differ");
          if (
            JSON.stringify(this.uniqueKeys(tableName)) !==
            JSON.stringify(this.uniqueKeys(probe, "temp"))
          )
            throw new SchemaMigrationError(tableName, "unique constraints differ");
          // Extra columns are retained. A versioned application migration decides when removing them is intentional.
          return actions;
        } finally {
          this.db.raw.exec(`DROP TABLE temp.${quoteIdentifier(probe)}`);
        }
      })
      .immediate();
  }

  private columns(table: string, schema = "main"): PragmaColumn[] {
    return this.db.raw
      .prepare(`PRAGMA ${quoteIdentifier(schema)}.table_xinfo(${quoteIdentifier(table)})`)
      .all() as PragmaColumn[];
  }

  private assertPrimaryKey(
    table: string,
    columns: readonly PragmaColumn[],
    options: TableSchemaOptions,
  ): void {
    const declared =
      typeof options.primaryKey === "string"
        ? [options.primaryKey]
        : (options.primaryKey ?? ["id"]);
    const actual = columns
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    if (JSON.stringify(declared) !== JSON.stringify(actual))
      throw new SchemaMigrationError(
        table,
        "primaryKey options disagree with the SQL primary-key constraint",
      );
  }

  private foreignKeys(table: string, schema = "main"): string[] {
    const rows = this.db.raw
      .prepare(`PRAGMA ${quoteIdentifier(schema)}.foreign_key_list(${quoteIdentifier(table)})`)
      .all() as ForeignKey[];
    const groups = new Map<number, ForeignKey[]>();
    for (const row of rows) {
      const group = groups.get(row.id) ?? [];
      group.push(row);
      groups.set(row.id, group);
    }
    return [...groups.values()]
      .map((group) =>
        JSON.stringify(group.sort((a, b) => a.seq - b.seq).map(({ id: _id, ...row }) => row)),
      )
      .sort();
  }

  private uniqueKeys(table: string, schema = "main"): string[] {
    const indexes = this.db.raw
      .prepare(`PRAGMA ${quoteIdentifier(schema)}.index_list(${quoteIdentifier(table)})`)
      .all() as { name: string; unique: number; origin: string; partial: number }[];
    return indexes
      .filter((index) => index.unique === 1)
      .map((index) => {
        const columns = this.db.raw
          .prepare(`PRAGMA ${quoteIdentifier(schema)}.index_xinfo(${quoteIdentifier(index.name)})`)
          .all() as {
          seqno: number;
          name: string | null;
          desc: number;
          coll: string;
          key: number;
        }[];
        const keyColumns = columns
          .filter((column) => column.key === 1)
          .sort((a, b) => a.seqno - b.seqno)
          .map(({ name, desc, coll }) => ({ name, desc, coll }));
        // A partial/expression index cannot stand in for a declared UNIQUE constraint on whole columns.
        const definition =
          index.partial !== 0 || keyColumns.some((column) => column.name === null)
            ? (
                this.db.raw
                  .prepare(
                    `SELECT sql FROM ${quoteIdentifier(schema)}.sqlite_schema WHERE name = ?`,
                  )
                  .get(index.name) as { sql: string | null }
              ).sql
            : null;
        return JSON.stringify({
          columns: keyColumns,
          primaryKey: index.origin === "pk",
          partial: index.partial,
          expression: definition === null ? null : normalizeSql(definition),
        });
      })
      .sort();
  }
}

function columnSql(column: Column): string {
  if (column.sqlType.trim() === "")
    throw new TypeError(`SQL type for ${column.name} cannot be empty.`);
  return `${quoteIdentifier(column.name)} ${column.sqlType}${column.constraints ? ` ${column.constraints}` : ""}`;
}

function createTableSql(
  table: string,
  columns: readonly Column[],
  options: TableSchemaOptions,
  temporary = false,
): string {
  const key =
    typeof options.primaryKey === "string" ? [options.primaryKey] : (options.primaryKey ?? ["id"]);
  const definitions = columns.map(columnSql);
  const inlineKey =
    columns.some((column) => /\bPRIMARY\s+KEY\b/i.test(column.constraints ?? "")) ||
    options.constraints?.some((constraint) => /\bPRIMARY\s+KEY\b/i.test(constraint));
  if (!inlineKey) definitions.push(`PRIMARY KEY (${key.map(quoteIdentifier).join(", ")})`);
  definitions.push(...(options.constraints ?? []));
  return `CREATE ${temporary ? "TEMP " : ""}TABLE ${quoteIdentifier(table)} (${definitions.join(", ")})${options.withoutRowid ? " WITHOUT ROWID" : ""}`;
}

function sqlTokens(sql: string): string[] {
  // String and quoted-identifier contents must retain case and whitespace during comparison.
  return (
    sql.match(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<>|!=|<=|>=|[^\s]/g,
    ) ?? []
  ).map((token) => (/^[A-Za-z_]/.test(token) ? token.toUpperCase() : token));
}

function normalizeSql(sql: string): string {
  return sqlTokens(sql).join(" ");
}

function checkConstraints(sql: string): string[] {
  const tokens = sqlTokens(sql);
  const checks: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== "CHECK" || tokens[index + 1] !== "(") continue;
    const start = index + 1;
    let depth = 0;
    for (index = start; index < tokens.length; index++) {
      if (tokens[index] === "(") depth++;
      if (tokens[index] === ")" && --depth === 0) break;
    }
    checks.push(tokens.slice(start, index + 1).join(" "));
  }
  return checks.sort();
}

function columnCollations(sql: string): Map<string, string> {
  const tokens = sqlTokens(sql);
  const entries: string[][] = [];
  let depth = 0;
  let start = 0;
  for (let index = tokens.indexOf("("); index < tokens.length; index++) {
    if (tokens[index] === "(") {
      if (depth === 0) start = index + 1;
      depth++;
    } else if (tokens[index] === ")") {
      depth--;
      if (depth === 0) {
        entries.push(tokens.slice(start, index));
        break;
      }
    } else if (tokens[index] === "," && depth === 1) {
      entries.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  const result = new Map<string, string>();
  for (const entry of entries) {
    const name = entry[0];
    if (
      name === undefined ||
      ["CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK"].includes(name)
    )
      continue;
    let collation = "BINARY";
    depth = 0;
    for (let index = 1; index < entry.length; index++) {
      if (entry[index] === "(") depth++;
      else if (entry[index] === ")") depth--;
      else if (depth === 0 && entry[index] === "COLLATE")
        collation = unquoteIdentifier(entry[index + 1] ?? "").toUpperCase();
    }
    result.set(unquoteIdentifier(name).toUpperCase(), collation);
  }
  return result;
}

function unquoteIdentifier(value: string): string {
  if (value.startsWith('"')) return value.slice(1, -1).replaceAll('""', '"');
  if (value.startsWith("`")) return value.slice(1, -1).replaceAll("``", "`");
  if (value.startsWith("[")) return value.slice(1, -1);
  return value;
}
