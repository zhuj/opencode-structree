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
    const revisions = quoteIdentifier(this.name);
    const table = quoteIdentifier(this.table);
    const key = quoteIdentifier(this.keyColumn);
    this.db.raw.exec(
      `CREATE TABLE IF NOT EXISTS ${revisions} (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)`,
    );
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
