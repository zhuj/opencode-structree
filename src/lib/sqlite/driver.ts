import { createRequire } from "node:module";
import type { FrameworkConfig } from "../types.ts";

export type SqlValue = string | number | bigint | Buffer | Uint8Array | null;

export interface SqlStatement {
  run(...values: SqlValue[]): { changes: number | bigint };
  get(...values: SqlValue[]): unknown;
  all(...values: SqlValue[]): unknown[];
}

export interface SqlTransaction<A> {
  (): A;
  deferred(): A;
  immediate(): A;
  exclusive(): A;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): unknown;
  loadExtension(path: string): unknown;
  transaction<A>(body: () => A): SqlTransaction<A>;
  /** JavaScript UDF registration is runtime-dependent; callers must check this capability. */
  function?(
    name: string,
    options: { deterministic?: boolean },
    callback: (...parameters: SqlValue[]) => SqlValue,
  ): unknown;
  close(): unknown;
}

/** Bun's SQLite library is shared by all connections in the process. */
export function createBunLibraryGuard(): (
  requested: string | undefined,
  select: (path: string) => boolean,
) => void {
  let selection: { path: string | undefined } | undefined;
  return (requested, select) => {
    if (selection !== undefined) {
      if (requested !== undefined && requested !== selection.path) {
        throw new Error(
          "Bun SQLite is already initialized with a different library selection; configure one customSQLite path before opening any Bun database.",
        );
      }
      return;
    }
    if (requested !== undefined && !select(requested))
      throw new Error(`Bun could not select the custom SQLite library: ${requested}`);
    // Opening can load SQLite even if the connection subsequently fails, so selection cannot be changed after this point.
    selection = { path: requested };
  };
}

const selectBunLibrary = createBunLibraryGuard();

export function openDatabase(config: FrameworkConfig["sqlite"]): SqlDatabase {
  const require = createRequire(import.meta.url);
  if (config.driver === "bun") {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    selectBunLibrary(config.customSQLite, (filename) => Database.setCustomSQLite(filename));
    return new Database(config.path, { create: true, strict: true }) as unknown as SqlDatabase;
  }
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  return new Database(config.path, { timeout: config.busyTimeoutMs }) as unknown as SqlDatabase;
}
