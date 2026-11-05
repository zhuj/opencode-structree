import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SqliteProcessLock, type SqliteProcessLockOptions } from "@local/object-mcp/sqlite";

/** Typed view of the private connection field for failure-injection tests. */
type LockInternals = { database: { exec: (sql: string) => unknown } };

const directories: string[] = [];
const locks: SqliteProcessLock[] = [];
const releases: Array<() => void> = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  releases.push(resolve);
  return { promise, resolve };
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(locks.splice(0).map((lock) => lock.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(driver: NonNullable<SqliteProcessLockOptions["driver"]>, timeoutMs = 1000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sqlite-process-lock-"));
  directories.push(directory);
  const options = {
    driver,
    path: path.join(directory, "coordination/lock.sqlite"),
    timeoutMs,
    retryIntervalMs: 2,
  };
  const first = await SqliteProcessLock.open(options);
  locks.push(first);
  const second = await SqliteProcessLock.open(options);
  locks.push(second);
  return { first, second };
}

for (const driver of ["better-sqlite3", "bun"] as const) {
  describe(`${driver} process lock`, () => {
    test("separate instances contend without blocking the event loop and recover after timeout", async () => {
      const { first, second } = await fixture(driver, 30);
      const entered = deferred();
      const release = deferred();
      let overlapping = false;
      const holder = first.run(async () => {
        entered.resolve();
        await release.promise;
        return "first finished";
      });
      await entered.promise;
      await expect(
        second.run(() => {
          overlapping = true;
        }),
      ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
      expect(overlapping).toBe(false);
      const order: string[] = [];
      const waiter = second.run(() => order.push("second"));
      const releaseTimer = setTimeout(() => {
        order.push("release");
        release.resolve();
      }, 5);
      try {
        expect(await holder).toBe("first finished");
        await waiter;
        expect(order).toEqual(["release", "second"]);
      } finally {
        clearTimeout(releaseTimer);
      }
    });

    test("one instance serializes its callers and releases the transaction after callback failure", async () => {
      const { first, second } = await fixture(driver);
      const entered = deferred();
      const release = deferred();
      const order: string[] = [];
      const failure = new Error("filesystem write failed");
      const failed = first.run(async () => {
        order.push("first entered");
        entered.resolve();
        await release.promise;
        throw failure;
      });
      const rejected = failed.catch((error: unknown) => error);
      await entered.promise;
      const next = first.run(() => {
        order.push("second entered");
        return "next";
      });
      const last = first.run(() => order.push("third entered"));
      await delay(5);
      expect(order).toEqual(["first entered"]);
      release.resolve();
      expect(await rejected).toBe(failure);
      expect(await next).toBe("next");
      await last;
      expect(order).toEqual(["first entered", "second entered", "third entered"]);
      expect(await second.run(() => "released to another connection")).toBe(
        "released to another connection",
      );
    });

    test("queued and SQLite-busy cancellation reject promptly without invoking either callback", async () => {
      const { first, second } = await fixture(driver);
      const entered = deferred();
      const release = deferred();
      const holder = first.run(async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      const queued = new AbortController();
      const busy = new AbortController();
      const queuedReason = new Error("cancel queued mutation");
      const busyReason = new Error("cancel waiting connection");
      let callbacks = 0;
      const queuedOperation = first.run(() => callbacks++, queued.signal);
      const busyOperation = second.run(() => callbacks++, busy.signal);
      const queuedRejected = queuedOperation.catch((error: unknown) => error);
      const busyRejected = busyOperation.catch((error: unknown) => error);
      await delay(5);
      queued.abort(queuedReason);
      busy.abort(busyReason);
      expect(await queuedRejected).toBe(queuedReason);
      expect(await busyRejected).toBe(busyReason);
      expect(callbacks).toBe(0);
      release.resolve();
      await holder;
      await first.run(() => undefined);
      await second.run(() => undefined);
      expect(callbacks).toBe(0);
    });

    test("active cancellation keeps the lock until work settles and close drains accepted operations", async () => {
      const { first, second } = await fixture(driver);
      const entered = deferred();
      const release = deferred();
      const queuedEntered = deferred();
      const releaseQueued = deferred();
      const abort = new AbortController();
      let activeSettled = false;
      const active = first.run(async () => {
        entered.resolve();
        await release.promise;
        return "source write finished";
      }, abort.signal);
      void active.then(() => {
        activeSettled = true;
      });
      await entered.promise;
      const queued = first.run(async () => {
        queuedEntered.resolve();
        await releaseQueued.promise;
      });
      const close = first.close();
      expect(first.close()).toBe(close);
      let closed = false;
      void close.then(() => {
        closed = true;
      });
      abort.abort(new Error("request canceled after mutation began"));
      await expect(first.run(() => undefined)).rejects.toMatchObject({ code: "CLOSED" });
      await delay(5);
      expect(activeSettled).toBe(false);
      expect(closed).toBe(false);
      release.resolve();
      expect(await active).toBe("source write finished");
      await queuedEntered.promise;
      expect(closed).toBe(false);
      releaseQueued.resolve();
      await queued;
      await close;
      expect(closed).toBe(true);
      expect(await second.run(() => "available after close")).toBe("available after close");
    });

    test("work failure takes precedence over ROLLBACK failure", async () => {
      const { first } = await fixture(driver);
      const lock = first as unknown as LockInternals;
      const primary = new Error("work failed");
      const rollbackError = new Error("rollback failed");
      const originalExec = lock.database.exec;
      // Documented contract: a non-enumerable `rollbackError` is attached to
      // the primary (a `cause` is chained when the primary has none); the
      // primary is always rethrown with its identity intact.
      lock.database.exec = (sql: string) => {
        if (sql === "ROLLBACK;") throw rollbackError;
        return originalExec.call(lock.database, sql);
      };
      const thrown = await first
        .run(() => {
          throw primary;
        })
        .then(
          () => {
            throw new Error("unexpected success");
          },
          (error: unknown) => error,
        );
      expect(thrown).toBe(primary);
      expect((thrown as { rollbackError?: unknown }).rollbackError).toBe(rollbackError);
    });

    test("frozen primary error still propagates unchanged when ROLLBACK fails", async () => {
      const { first } = await fixture(driver);
      const lock = first as unknown as LockInternals;
      const primary = Object.freeze(new Error("work failed"));
      const rollbackError = new Error("rollback failed");
      const originalExec = lock.database.exec;
      lock.database.exec = (sql: string) => {
        if (sql === "ROLLBACK;") throw rollbackError;
        return originalExec.call(lock.database, sql);
      };
      const thrown = await first
        .run(() => {
          throw primary;
        })
        .then(
          () => {
            throw new Error("unexpected success");
          },
          (error: unknown) => error,
        );
      expect(thrown).toBe(primary);
    });

    test("a failed ROLLBACK retries once and the connection recovers for the next run", async () => {
      const { first } = await fixture(driver);
      const lock = first as unknown as LockInternals;
      const primary = new Error("work failed");
      const rollbackError = new Error("rollback failed");
      const originalExec = lock.database.exec;
      let rollbackAttempts = 0;
      lock.database.exec = (sql: string) => {
        if (sql === "ROLLBACK;") {
          rollbackAttempts += 1;
          if (rollbackAttempts === 1) throw rollbackError;
        }
        return originalExec.call(lock.database, sql);
      };
      const thrown = await first
        .run(() => {
          throw primary;
        })
        .then(
          () => {
            throw new Error("unexpected success");
          },
          (error: unknown) => error,
        );
      expect(thrown).toBe(primary);
      expect((thrown as { rollbackError?: unknown }).rollbackError).toBe(rollbackError);
      expect(rollbackAttempts).toBe(2);
      // The retry released the stranded transaction: the same connection can
      // begin, execute, and commit again.
      expect(await first.run(() => "after recovery")).toBe("after recovery");
      lock.database.exec =
        typeof originalExec === "function" ? originalExec.bind(lock.database) : originalExec;
    });

    test("a failed ROLLBACK retry that also fails does not mask the primary error", async () => {
      const { first } = await fixture(driver);
      const lock = first as unknown as LockInternals;
      const primary = new Error("work failed");
      const rollbackError = new Error("rollback failed");
      const originalExec = lock.database.exec;
      let rollbackAttempts = 0;
      lock.database.exec = (sql: string) => {
        if (sql === "ROLLBACK;") {
          rollbackAttempts += 1;
          throw rollbackError;
        }
        return originalExec.call(lock.database, sql);
      };
      const thrown = await first
        .run(() => {
          throw primary;
        })
        .then(
          () => {
            throw new Error("unexpected success");
          },
          (error: unknown) => error,
        );
      expect(thrown).toBe(primary);
      expect((thrown as { rollbackError?: unknown }).rollbackError).toBe(rollbackError);
      expect(rollbackAttempts).toBe(2);
      // Fixture best-effort cleanup: release the stranded transaction and
      // restore the real exec.
      try {
        originalExec.call(lock.database, "ROLLBACK;");
      } catch {
        // Fixture best-effort cleanup.
      }
      lock.database.exec =
        typeof originalExec === "function" ? originalExec.bind(lock.database) : originalExec;
    });

    test("a primary error without a cause gains a non-enumerable cause and rollbackError", async () => {
      const { first } = await fixture(driver);
      const lock = first as unknown as LockInternals;
      const primary = new Error("work failed");
      const rollbackError = new Error("rollback failed");
      const originalExec = lock.database.exec;
      lock.database.exec = (sql: string) => {
        if (sql === "ROLLBACK;") throw rollbackError;
        return originalExec.call(lock.database, sql);
      };
      const thrown = await first
        .run(() => {
          throw primary;
        })
        .then(
          () => {
            throw new Error("unexpected success");
          },
          (error: unknown) => error,
        );
      expect(thrown).toBe(primary);
      expect((thrown as { cause?: unknown }).cause).toBe(rollbackError);
      expect(Object.getOwnPropertyDescriptor(thrown as object, "cause")?.enumerable).toBe(false);
      expect((thrown as { rollbackError?: unknown }).rollbackError).toBe(rollbackError);
      expect(Object.getOwnPropertyDescriptor(thrown as object, "rollbackError")?.enumerable).toBe(
        false,
      );
      // Fixture best-effort cleanup: release the stranded transaction and
      // restore the real exec.
      try {
        originalExec.call(lock.database, "ROLLBACK;");
      } catch {
        // Fixture best-effort cleanup.
      }
      lock.database.exec =
        typeof originalExec === "function" ? originalExec.bind(lock.database) : originalExec;
    });
  });
}

test("COMMIT failure takes precedence over ROLLBACK failure and propagates unchanged when ROLLBACK succeeds", async () => {
  const { first } = await fixture("bun");
  const lock = first as unknown as LockInternals;
  const originalExec = lock.database.exec;
  const commitError = new Error("commit failed");
  const rollbackError = new Error("rollback failed");

  // COMMIT throws + ROLLBACK throws → COMMIT error wins with rollback attached.
  lock.database.exec = (sql: string) => {
    if (sql === "COMMIT;") throw commitError;
    if (sql === "ROLLBACK;") throw rollbackError;
    return originalExec.call(lock.database, sql);
  };
  const bothFail = await first
    .run(() => "ok")
    .then(
      () => {
        throw new Error("unexpected success");
      },
      (error: unknown) => error,
    );
  expect(bothFail).toBe(commitError);
  expect((bothFail as { rollbackError?: unknown }).rollbackError).toBe(rollbackError);
  // Rollback was skipped, so the stranded transaction must be rolled back and
  // the real exec restored before the next case reuses this connection.
  // Fresh errors avoid cross-case `rollbackError` state on a reused instance.
  try {
    originalExec.call(lock.database, "ROLLBACK;");
  } catch {
    // Fixture best-effort cleanup.
  }
  lock.database.exec =
    typeof originalExec === "function" ? originalExec.bind(lock.database) : originalExec;

  // COMMIT throws + ROLLBACK succeeds → COMMIT error unchanged, no rollbackError.
  const commitError2 = new Error("commit failed only");
  lock.database.exec = (sql: string) => {
    if (sql === "COMMIT;") throw commitError2;
    return originalExec.call(lock.database, sql);
  };
  const commitOnly = await first
    .run(() => "ok")
    .then(
      () => {
        throw new Error("unexpected success");
      },
      (error: unknown) => error,
    );
  expect(commitOnly).toBe(commitError2);
  expect((commitOnly as { rollbackError?: unknown }).rollbackError).toBeUndefined();
});

test("normal commit path is unchanged and acquire timeout keeps LOCK_TIMEOUT", async () => {
  const { first, second } = await fixture("bun", 30);
  expect(await first.run(() => "committed")).toBe("committed");
  const entered = deferred();
  const release = deferred();
  const holder = first.run(async () => {
    entered.resolve();
    await release.promise;
    return "held";
  });
  await entered.promise;
  await expect(second.run(() => "unreachable")).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
  release.resolve();
  expect(await holder).toBe("held");
});

test("process locks require a shared file instead of a private in-memory database", async () => {
  await expect(SqliteProcessLock.open({ path: ":memory:" })).rejects.toMatchObject({
    code: "CONFIG",
  });
});
