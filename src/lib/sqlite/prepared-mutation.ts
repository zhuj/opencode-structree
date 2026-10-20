import type { Database } from "./database.ts";
import { MutationConflictError } from "./errors.ts";
import { quoteIdentifier } from "./filter.ts";

/** Runs in the same transaction; hooks may perform only synchronous SQL on this connection. */
export type MutationCommitHook<Result> = (result: Result) => undefined;

/** Preparation can await providers; committing the prepared result must never await. */
export interface PreparedMutation<Result> {
  readonly id: string;
  readonly commit: (hook?: MutationCommitHook<Result>) => Result;
}

/** Tombstones survive DELETE/recreate, so equal row values cannot hide an intervening write (ABA). */
export class MutationRevisions {
  private readonly name: string;

  constructor(
    private readonly db: Database,
    private readonly table: string,
    private readonly keyColumn = "id",
  ) {
    quoteIdentifier(table);
    quoteIdentifier(keyColumn);
    this.name = `${table}_mutation_revisions`;
  }

  initialize(): void {
    this.ensureRevisionTable();
    const revisions = quoteIdentifier(this.name);
    const table = quoteIdentifier(this.table);
    const key = quoteIdentifier(this.keyColumn);
    for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
      const reference = operation === "DELETE" ? "OLD" : "NEW";
      this.db.raw.exec(`CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(`${this.name}_${operation}`)}
        AFTER ${operation} ON ${table} BEGIN
          INSERT INTO ${revisions} (id, revision) VALUES (${reference}.${key}, 1)
          ON CONFLICT(id) DO UPDATE SET revision = revision + 1;
        END`);
    }
    // Raw SQL can move a key even though Table.update rejects it. Invalidate the old identity too.
    this.db.raw.exec(`CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(`${this.name}_MOVE`)}
      AFTER UPDATE OF ${key} ON ${table} WHEN OLD.${key} IS NOT NEW.${key} BEGIN
        INSERT INTO ${revisions} (id, revision) VALUES (OLD.${key}, 1)
        ON CONFLICT(id) DO UPDATE SET revision = revision + 1;
      END`);
  }

  /**
   * Revision identity has to match source identity: a key column declared COLLATE NOCASE
   * resolves several spellings to one row, and every spelling must share one revision.
   * The revision table therefore uses the source key column's collation.
   */
  private ensureRevisionTable(): void {
    const collation = this.sourceCollation();
    const revisions = quoteIdentifier(this.name);
    const existing = this.db.raw
      .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`)
      .get(this.name) as { sql: string | null } | undefined;
    if (existing == null) {
      this.db.raw.exec(
        `CREATE TABLE ${revisions} (id TEXT COLLATE ${collation} PRIMARY KEY, revision INTEGER NOT NULL)`,
      );
      return;
    }
    if (columnCollation(existing.sql ?? undefined, "id") === collation) return;
    this.migrateRevisionTable(collation);
  }

  /** Rebuilds the revision table with the source collation, keeping the highest revision per identity. */
  private migrateRevisionTable(collation: string): void {
    const revisions = quoteIdentifier(this.name);
    const migrated = quoteIdentifier(`${this.name}_migrated`);
    this.db.raw
      .transaction(() => {
        // The triggers are recreated after the table has been replaced.
        this.dropTriggers();
        this.db.raw.exec(
          `CREATE TABLE ${migrated} (id TEXT COLLATE ${collation} PRIMARY KEY, revision INTEGER NOT NULL)`,
        );
        // OR REPLACE keeps the last inserted row, so the highest revision per identity wins.
        this.db.raw.exec(
          `INSERT OR REPLACE INTO ${migrated} (id, revision) SELECT id, revision FROM ${revisions} ORDER BY revision ASC`,
        );
        this.db.raw.exec(`DROP TABLE ${revisions}`);
        this.db.raw.exec(`ALTER TABLE ${migrated} RENAME TO ${quoteIdentifier(this.name)}`);
      })
      .immediate();
  }

  private dropTriggers(): void {
    for (const suffix of ["INSERT", "UPDATE", "DELETE", "MOVE"]) {
      this.db.raw.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(`${this.name}_${suffix}`)}`);
    }
  }

  private sourceCollation(): string {
    const row = this.db.raw
      .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`)
      .get(this.table) as { sql: string | null } | undefined;
    return columnCollation(row?.sql ?? undefined, this.keyColumn);
  }

  read(id: string): number {
    const row = this.db.raw
      .prepare(`SELECT revision FROM ${quoteIdentifier(this.name)} WHERE id = ?`)
      .get(id) as { revision: number } | undefined;
    const revision = row?.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new RangeError(
        "Mutation revision exceeds the safe integer range; explicit revision migration is required.",
      );
    return revision;
  }

  touch(id: string): void {
    this.db.raw
      .prepare(`INSERT INTO ${quoteIdentifier(this.name)} (id, revision) VALUES (?, 1)
      ON CONFLICT(id) DO UPDATE SET revision = revision + 1`)
      .run(id);
  }

  prepare<Result>(
    snapshot: { readonly id: string; readonly revision: number },
    write: () => Result,
  ): PreparedMutation<Result> {
    const { id, revision } = snapshot;
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new TypeError("A prepared mutation requires a nonnegative safe revision.");
    rejectAsyncFunction(write);
    let state: "prepared" | "committing" | "consumed" = "prepared";
    return {
      id,
      commit: (hook) => {
        if (state !== "prepared") throw new MutationConflictError(this.table, id);
        if (hook !== undefined) rejectAsyncFunction(hook);
        state = "committing";
        try {
          const result = this.db.raw
            .transaction(() => {
              if (this.read(id) !== revision) throw new MutationConflictError(this.table, id);
              const value = write();
              rejectThenable(value);
              if (hook !== undefined) {
                const hookResult = hook(value);
                rejectThenable(hookResult);
                if (hookResult !== undefined)
                  throw new TypeError("Mutation commit hook must return undefined synchronously.");
              }
              return value;
            })
            .immediate();
          state = "consumed";
          return result;
        } catch (error) {
          // A failed transaction leaves no writes/revision changes; retrying the same prepared value is safe.
          state = "prepared";
          throw error;
        }
      },
    };
  }
}

function rejectAsyncFunction(callback: (...args: never[]) => unknown): void {
  if (callback.constructor.name === "AsyncFunction")
    throw new TypeError("Mutation commit callbacks must be synchronous.");
}

function rejectThenable(value: unknown): void {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  ) {
    // The type contract rejects promises. Consume an accidental rejected promise while rolling back its SQL.
    void Promise.resolve(value).catch(() => undefined);
    throw new TypeError("Mutation commit callbacks must not return a promise.");
  }
}

const TABLE_CONSTRAINT_KEYWORDS = new Set(["CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK"]);

/** Reads the COLLATE a column declares, defaulting to SQLite's BINARY comparison. */
function columnCollation(sql: string | undefined, column: string): string {
  if (sql === undefined) return "BINARY";
  for (const entry of tableColumnDefinitions(sql)) {
    const name = entry[0];
    if (name === undefined) continue;
    const identifier = unquoteIdentifier(name).toUpperCase();
    if (TABLE_CONSTRAINT_KEYWORDS.has(identifier)) continue;
    if (identifier !== column.toUpperCase()) continue;
    let depth = 0;
    for (let index = 1; index < entry.length; index++) {
      const token = entry[index];
      if (token === "(") depth++;
      else if (token === ")") depth--;
      else if (depth === 0 && token === "COLLATE") {
        const collation = unquoteIdentifier(entry[index + 1] ?? "").toUpperCase();
        return /^[A-Z_][A-Z0-9_]*$/.test(collation) ? collation : "BINARY";
      }
    }
    return "BINARY";
  }
  return "BINARY";
}

/** Splits the column list of a CREATE TABLE statement into its top-level definitions. */
function tableColumnDefinitions(sql: string): string[][] {
  const tokens = sqlTokens(sql);
  const open = tokens.indexOf("(");
  if (open < 0) return [];
  const definitions: string[][] = [];
  let depth = 0;
  let start = open + 1;
  for (let index = open; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "(") depth++;
    else if (token === ")") {
      depth--;
      if (depth === 0) {
        definitions.push(tokens.slice(start, index));
        break;
      }
    } else if (token === "," && depth === 1) {
      definitions.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  return definitions;
}

/** Mirrors the migrator's statement inspection so both read a schema the same way. */
function sqlTokens(sql: string): string[] {
  return (
    sql.match(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<>|!=|<=|>=|[^\s]/g,
    ) ?? []
  ).map((token) => (/^[A-Za-z_]/.test(token) ? token.toUpperCase() : token));
}

function unquoteIdentifier(value: string): string {
  if (value.startsWith('"')) return value.slice(1, -1).replaceAll('""', '"');
  if (value.startsWith("`")) return value.slice(1, -1).replaceAll("``", "`");
  if (value.startsWith("[")) return value.slice(1, -1);
  return value;
}
