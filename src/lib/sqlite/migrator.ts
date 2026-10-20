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
    try {
      return this.db.raw
        .transaction(() => {
          this.assertSupportedConflictPolicies(tableName, desiredSql, "requested");
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
          this.assertSupportedConflictPolicies(tableName, entry.sql, "existing");

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
                throw new SchemaMigrationError(
                  tableName,
                  `cannot add column ${column.name} safely`,
                  {
                    cause,
                  },
                );
              }
              actions.push(`added column "${column.name}"`);
            }
            existing = this.columns(tableName);
            const actualSql = (
              this.db.raw
                .prepare("SELECT sql FROM sqlite_schema WHERE name = ?")
                .get(tableName) as {
                sql: string;
              }
            ).sql;
            const actualExpressions = declaredGenerationExpressions(actualSql);
            const desiredExpressions = declaredGenerationExpressions(desiredSql);
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
              // PRAGMA cannot report a generation expression, so the declared SQL is the only source.
              if (actual.hidden < 2 && expected.hidden < 2) continue;
              const actualExpression = actualExpressions.get(declaredNameKey(actual.name));
              const desiredExpression = desiredExpressions.get(declaredNameKey(expected.name));
              if (actualExpression === undefined || desiredExpression === undefined)
                throw new SchemaMigrationError(
                  tableName,
                  `${expected.name} has an unreadable generation expression`,
                );
              if (actualExpression !== desiredExpression)
                throw new SchemaMigrationError(
                  tableName,
                  `${expected.name} has an incompatible generation expression`,
                );
            }
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
    } catch (cause) {
      // A declaration that cannot be read is refused like any other incompatible layout.
      if (cause instanceof UnterminatedSqlCommentError)
        throw new SchemaMigrationError(
          tableName,
          "the declared SQL contains an unterminated comment",
          { cause },
        );
      throw cause;
    }
  }

  /**
   * A conflict policy other than the implicit ABORT changes what a conflicting write does to
   * stored rows, and PRAGMA cannot report it, so the declared SQL is the only source that can
   * refuse such a layout.
   */
  private assertSupportedConflictPolicies(
    table: string,
    sql: string,
    origin: "existing" | "requested",
  ): void {
    for (const declared of declaredUniqueConflictPolicies(sql)) {
      if (declared.policy === DEFAULT_CONFLICT_POLICY) continue;
      throw new SchemaMigrationError(
        table,
        `${origin} unique constraint ${describeConstraintColumns(declared.columns)} declares ON CONFLICT ${declared.policy}, which the migrator cannot support`,
      );
    }
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

interface SqlToken {
  /** The matched source text, so a declared name keeps its original case. */
  readonly text: string;
  /** The comparable form: bare identifiers and keywords are uppercased. */
  readonly token: string;
}

/** A comment that never terminates leaves the declaration unreadable. */
class UnterminatedSqlCommentError extends Error {
  constructor() {
    super("unterminated SQL comment");
    this.name = "UnterminatedSqlCommentError";
  }
}

/**
 * SQLite treats a comment as whitespace, so a comment can neither hide nor fabricate a
 * declared constraint. Every comment is therefore replaced by a single space, which keeps the
 * tokens around it separate. Quoted literals are copied verbatim, so a string that looks like
 * a comment keeps its content.
 */
function stripSqlComments(sql: string): string {
  let result = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (char === undefined) break;
    if (char === "'" || char === '"' || char === "`") {
      const end = quotedLiteralEnd(sql, index, char);
      // An unterminated literal is not a comment: only its opening quote is kept, so the
      // rest of the declaration stays readable.
      if (end === -1) {
        result += char;
        index += 1;
        continue;
      }
      result += sql.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === "[") {
      const end = sql.indexOf("]", index + 1);
      if (end === -1) {
        result += char;
        index += 1;
        continue;
      }
      result += sql.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") {
      // A line comment ends at the end of its line, never at the end of the statement.
      const newline = sql.indexOf("\n", index + 2);
      result += " ";
      index = newline === -1 ? sql.length : newline;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) throw new UnterminatedSqlCommentError();
      result += " ";
      index = end + 2;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

/** The end index of a quoted literal, honouring the doubled quote SQLite accepts. */
function quotedLiteralEnd(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    return index;
  }
  return -1;
}

function sqlTokenList(sql: string): SqlToken[] {
  // String and quoted-identifier contents must retain case and whitespace during comparison.
  return (
    stripSqlComments(sql).match(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<>|!=|<=|>=|[^\s]/g,
    ) ?? []
  ).map((text) => ({
    text,
    token: /^[A-Za-z_]/.test(text) ? text.toUpperCase() : text,
  }));
}

function sqlTokens(sql: string): string[] {
  return sqlTokenList(sql).map((entry) => entry.token);
}

function normalizeSql(sql: string): string {
  return sqlTokens(sql).join(" ");
}

interface DeclaredConflictPolicy {
  readonly policy: string;
  readonly columns: readonly string[];
}

/** ABORT is the implicit default; every other policy changes what a conflicting write does. */
const DEFAULT_CONFLICT_POLICY = "ABORT";
const CONFLICT_POLICIES = new Set(["ROLLBACK", "ABORT", "FAIL", "IGNORE", "REPLACE"]);

function describeConstraintColumns(columns: readonly string[]): string {
  if (columns.length === 1) return `"${columns[0] ?? ""}"`;
  return `(${columns.map((column) => `"${column}"`).join(", ")})`;
}

/** The declared table body split into its top-level column and constraint definitions. */
function tableBodyEntries(sql: string): SqlToken[][] {
  const tokens = sqlTokenList(sql);
  const tableIndex = tokens.findIndex((entry) => entry.token === "TABLE");
  if (tableIndex === -1) return [];
  let open = -1;
  for (let index = tableIndex + 1; index < tokens.length; index++) {
    const token = tokens[index]?.token;
    // "CREATE TABLE ... AS SELECT" declares no column or constraint definitions.
    if (token === "AS") return [];
    if (token === "(") {
      open = index;
      break;
    }
  }
  if (open === -1) return [];
  const entries: SqlToken[][] = [];
  let current: SqlToken[] = [];
  let depth = 0;
  for (let index = open + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.token === "(") {
      depth++;
      current.push(token);
      continue;
    }
    if (token.token === ")") {
      if (depth === 0) {
        entries.push(current);
        break;
      }
      depth--;
      current.push(token);
      continue;
    }
    if (token.token === "," && depth === 0) {
      entries.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  return entries;
}

/** Every UNIQUE constraint of the declared SQL that carries an explicit conflict policy. */
function declaredUniqueConflictPolicies(sql: string): DeclaredConflictPolicy[] {
  const declared: DeclaredConflictPolicy[] = [];
  for (const entry of tableBodyEntries(sql)) {
    const head = entry[0];
    if (head === undefined) continue;
    if (head.token === "CONSTRAINT") {
      const kind = entry.findIndex((token) =>
        ["PRIMARY", "UNIQUE", "FOREIGN", "CHECK"].includes(token.token),
      );
      if (kind === -1 || entry[kind]?.token !== "UNIQUE") continue;
      const policy = tableConflictPolicy(entry, kind);
      if (policy !== null) declared.push(policy);
      continue;
    }
    if (head.token === "UNIQUE" && entry[1]?.token === "(") {
      const policy = tableConflictPolicy(entry, 0);
      if (policy !== null) declared.push(policy);
      continue;
    }
    // A column constraint declares its policy directly after UNIQUE.
    const uniqueIndex = entry.findIndex((token) => token.token === "UNIQUE");
    if (uniqueIndex === -1) continue;
    const policy = conflictPolicyAt(entry, uniqueIndex + 1);
    if (policy === null) continue;
    declared.push({ policy, columns: [unquoteIdentifier(head.text)] });
  }
  return declared;
}

function tableConflictPolicy(
  entry: readonly SqlToken[],
  uniqueIndex: number,
): DeclaredConflictPolicy | null {
  // A table constraint declares its policy after the constrained column list.
  const open = entry.findIndex((token, index) => index >= uniqueIndex && token.token === "(");
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < entry.length; index++) {
    const token = entry[index]?.token;
    if (token === "(") {
      depth++;
      continue;
    }
    if (token !== ")") continue;
    depth--;
    if (depth !== 0) continue;
    const policy = conflictPolicyAt(entry, index + 1);
    if (policy === null) return null;
    return { policy, columns: constraintColumnNames(entry.slice(open + 1, index)) };
  }
  return null;
}

function conflictPolicyAt(tokens: readonly SqlToken[], index: number): string | null {
  if (tokens[index]?.token !== "ON" || tokens[index + 1]?.token !== "CONFLICT") return null;
  const policy = tokens[index + 2]?.token;
  if (policy === undefined || !CONFLICT_POLICIES.has(policy)) return null;
  return policy;
}

function constraintColumnNames(tokens: readonly SqlToken[]): string[] {
  const names: string[] = [];
  let current: SqlToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.token === "(") depth++;
    else if (token.token === ")") depth--;
    else if (token.token === "," && depth === 0) {
      const name = current[0];
      if (name !== undefined) names.push(unquoteIdentifier(name.text));
      current = [];
      continue;
    }
    current.push(token);
  }
  const name = current[0];
  if (name !== undefined) names.push(unquoteIdentifier(name.text));
  return names;
}

/** The normalized generation expression of every generated column of the declared SQL. */
function declaredGenerationExpressions(sql: string): Map<string, string> {
  const expressions = new Map<string, string>();
  for (const entry of tableBodyEntries(sql)) {
    const name = entry[0];
    if (name === undefined) continue;
    if (["CONSTRAINT", "PRIMARY", "UNIQUE", "FOREIGN", "CHECK"].includes(name.token)) continue;
    const expression = generationExpression(entry);
    if (expression === null) continue;
    expressions.set(declaredNameKey(name.text), expression);
  }
  return expressions;
}

/** SQLite identifiers are case-insensitive, so a declared name is compared without its case. */
function declaredNameKey(text: string): string {
  return unquoteIdentifier(text).toUpperCase();
}

function generationExpression(entry: readonly SqlToken[]): string | null {
  let depth = 0;
  for (let index = 0; index < entry.length; index++) {
    const token = entry[index]?.token;
    if (token === "(") {
      depth++;
      continue;
    }
    if (token === ")") {
      depth--;
      continue;
    }
    if (depth !== 0 || token !== "AS") continue;
    if (entry[index + 1]?.token !== "(") continue;
    let inner = 0;
    for (let end = index + 1; end < entry.length; end++) {
      if (entry[end]?.token === "(") inner++;
      else if (entry[end]?.token === ")") {
        inner--;
        if (inner === 0)
          return `(${entry
            .slice(index + 2, end)
            .map((part) => part.token)
            .join(" ")})`;
      }
    }
    return null;
  }
  return null;
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
