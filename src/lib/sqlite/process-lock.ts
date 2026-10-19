import { mkdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FrameworkError } from "../errors.ts";
import { openDatabase, type SqlDatabase } from "./driver.ts";

export interface SqliteProcessLockOptions {
  readonly path: string;
  readonly driver?: "better-sqlite3" | "bun";
  readonly customSQLite?: string;
  readonly timeoutMs?: number;
  readonly retryIntervalMs?: number;
}

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

/** Use a dedicated database: this connection holds an OS lock across asynchronous work. */
export class SqliteProcessLock {
  readonly path: string;
  private readonly timeoutMs: number;
  private readonly retryIntervalMs: number;
  private database: SqlDatabase | undefined;
  private tail = Promise.resolve();
  private closing = false;
  private closePromise: Promise<void> | undefined;

  private constructor(options: SqliteProcessLockOptions) {
    if (
      typeof options.path !== "string" ||
      options.path.length === 0 ||
      options.path === ":memory:"
    ) {
      throw new FrameworkError(
        "CONFIG",
        "Process coordination requires a dedicated SQLite file path.",
      );
    }
    const driver = options.driver ?? "better-sqlite3";
    if (driver !== "better-sqlite3" && driver !== "bun") {
      throw new FrameworkError("CONFIG", "Unsupported SQLite process-lock driver.");
    }
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryIntervalMs = options.retryIntervalMs ?? 50;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 0) {
      throw new FrameworkError("CONFIG", "The process-lock timeout must be a nonnegative integer.");
    }
    if (!Number.isSafeInteger(this.retryIntervalMs) || this.retryIntervalMs < 1) {
      throw new FrameworkError(
        "CONFIG",
        "The process-lock retry interval must be a positive integer.",
      );
    }
    this.path = path.resolve(options.path);
    mkdirSync(path.dirname(this.path), { recursive: true });
    const database = openDatabase({
      path: this.path,
      driver,
      busyTimeoutMs: 0,
      ...(options.customSQLite === undefined ? {} : { customSQLite: options.customSQLite }),
    });
    try {
      database.exec("PRAGMA busy_timeout = 0;");
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  static async open(options: SqliteProcessLockOptions): Promise<SqliteProcessLock> {
    const lock = new SqliteProcessLock(options);
    try {
      await lock.run(() => {
        lock
          .connection()
          .exec(
            "CREATE TABLE IF NOT EXISTS object_mcp_coordination (singleton INTEGER PRIMARY KEY CHECK(singleton = 1));",
          );
      });
      return lock;
    } catch (error) {
      await lock.close();
      throw error;
    }
  }

  private connection(): SqlDatabase {
    if (!this.database)
      throw new FrameworkError("CLOSED", "SQLite process coordination is closed.");
    return this.database;
  }

  run<A>(work: () => A | Promise<A>, signal?: AbortSignal): Promise<A> {
    if (this.closing) {
      return Promise.reject(
        new FrameworkError("CLOSED", "SQLite process coordination is closing or closed."),
      );
    }
    if (signal?.aborted) return Promise.reject(signal.reason);
    let started = false;
    let cancelWaiting: (() => void) | undefined;
    const operation = this.tail.then(() => {
      started = true;
      if (cancelWaiting) signal?.removeEventListener("abort", cancelWaiting);
      signal?.throwIfAborted();
      return this.execute(work, signal);
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return new Promise<A>((resolve, reject) => {
      cancelWaiting = () => {
        if (!started) reject(signal?.reason);
      };
      signal?.addEventListener("abort", cancelWaiting, { once: true });
      void operation.then(resolve, reject);
    });
  }

  private async acquire(database: SqlDatabase, signal?: AbortSignal): Promise<void> {
    const deadline = performance.now() + this.timeoutMs;
    while (true) {
      signal?.throwIfAborted();
      try {
        // Native busy handlers would block cancellation and unrelated event-loop work.
        database.exec("BEGIN IMMEDIATE;");
        return;
      } catch (error) {
        if (!isBusy(error)) throw error;
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
          throw new FrameworkError(
            "LOCK_TIMEOUT",
            "Another operation holds the SQLite process lock.",
            {
              path: this.path,
            },
          );
        }
        try {
          await delay(
            Math.min(this.retryIntervalMs, Math.max(1, remaining)),
            undefined,
            signal ? { signal } : {},
          );
        } catch (error) {
          signal?.throwIfAborted();
          throw error;
        }
      }
    }
  }

  private async execute<A>(work: () => A | Promise<A>, signal?: AbortSignal): Promise<A> {
    const database = this.connection();
    await this.acquire(database, signal);
    let held = true;
    try {
      signal?.throwIfAborted();
      // Cancellation cannot release the permit while the callback can still mutate its external resource.
      const result = await work();
      database.exec("COMMIT;");
      held = false;
      return result;
    } finally {
      if (held) database.exec("ROLLBACK;");
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.tail.then(() => {
      const database = this.database;
      this.database = undefined;
      database?.close();
    });
    return this.closePromise;
  }
}
