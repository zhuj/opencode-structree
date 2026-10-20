import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ReconciliationIdentityError, reconcileSnapshot } from "../src/lib/vault/reconciliation.ts";
import { WatchLifecycle, WatchStoppedError } from "../src/lib/vault/watch-lifecycle.ts";
import {
  type FileChange,
  FileWatcher,
  type WatchCallbacks,
  WatcherClosedError,
  type WatchSource,
} from "../src/lib/vault/watcher.ts";

const releases: Array<() => void> = [];
const cleanup: Array<() => Promise<unknown>> = [];
const directories: string[] = [];

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function eventually(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for vault synchronization.");
    await delay(5);
  }
}

function own<Report>(lifecycle: WatchLifecycle<Report>): WatchLifecycle<Report> {
  cleanup.push(() => lifecycle.shutdown());
  return lifecycle;
}

class ManualWatcher implements WatchSource {
  readonly ready = deferred<void>();
  callbacks: WatchCallbacks | undefined;
  installed = false;
  closed = false;
  closeCalls = 0;

  constructor(ready = true) {
    if (ready) this.ready.resolve();
  }

  start(callbacks: WatchCallbacks): Promise<void> {
    this.installed = true;
    this.callbacks = callbacks;
    return this.ready.promise;
  }

  change(filename = "documents/a.md"): void {
    this.callbacks?.onChange({ event: "change", path: filename });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closeCalls++;
    this.ready.reject(new WatcherClosedError());
  }
}

describe("reusable vault lifecycle", () => {
  test("watcher readiness precedes the initial scan and changes during that scan cause another pass", async () => {
    const watcher = new ManualWatcher(false);
    const entered = deferred<void>();
    const finish = deferred<void>();
    releases.push(() => finish.resolve());
    const events: string[] = [];
    let calls = 0;
    const lifecycle = own(
      new WatchLifecycle(
        async () => {
          expect(watcher.installed).toBe(true);
          const current = ++calls;
          if (current === 1) {
            entered.resolve();
            await finish.promise;
          }
          return current;
        },
        {
          watcher,
          debounceMs: 0,
          rescanIntervalMs: 0,
          onChange: (change) => events.push(change.path),
        },
      ),
    );
    const starting = lifecycle.start();
    watcher.change("documents/before-ready.md");
    await delay(5);
    expect(calls).toBe(0);
    watcher.ready.resolve();
    await entered.promise;
    watcher.change("documents/during-scan.md");
    expect(lifecycle.dirty).toBe(true);
    finish.resolve();
    expect(await starting).toBe(2);
    expect(calls).toBe(2);
    expect(lifecycle.dirty).toBe(false);
    expect(events).toEqual(["documents/before-ready.md", "documents/during-scan.md"]);
  });

  test("parallel resync requests share all dirty passes while cancellation belongs to one waiter", async () => {
    const entered = deferred<void>();
    const finish = deferred<void>();
    releases.push(() => finish.resolve());
    const completed: number[] = [];
    let calls = 0;
    let active = 0;
    let peak = 0;
    const lifecycle = own(
      new WatchLifecycle(
        async () => {
          const current = ++calls;
          peak = Math.max(peak, ++active);
          try {
            if (current === 2) {
              entered.resolve();
              await finish.promise;
            }
            return current;
          } finally {
            active--;
          }
        },
        { rescanIntervalMs: 0, onComplete: (report) => completed.push(report) },
      ),
    );
    expect(await lifecycle.start()).toBe(1);
    const controller = new AbortController();
    const cancelled = lifecycle.resync(controller.signal).catch((error: unknown) => error);
    const surviving = lifecycle.resync();
    await entered.promise;
    lifecycle.requestResync();
    lifecycle.requestResync();
    controller.abort(new DOMException("One waiter stopped", "AbortError"));
    expect(await cancelled).toBeInstanceOf(DOMException);
    expect(active).toBe(1);
    expect(lifecycle.syncing).toBe(true);
    finish.resolve();
    expect(await surviving).toBe(3);
    expect(peak).toBe(1);
    expect(completed).toEqual([1, 3]);
    expect(lifecycle.syncing).toBe(false);
  });

  test("continuous changes yield after the pass limit and continue in a later batch", async () => {
    const completed: number[] = [];
    let calls = 0;
    let lifecycle!: WatchLifecycle<number>;
    lifecycle = own(
      new WatchLifecycle(
        async () => {
          const current = ++calls;
          if (current <= 3) lifecycle.requestResync();
          return current;
        },
        {
          debounceMs: 1,
          rescanIntervalMs: 0,
          maxPasses: 2,
          onComplete: (report) => completed.push(report),
        },
      ),
    );
    expect(await lifecycle.start()).toBe(2);
    expect(lifecycle.dirty).toBe(true);
    await eventually(() => completed.length === 2);
    expect(completed).toEqual([2, 4]);
    expect(lifecycle.dirty).toBe(false);
  });

  test("an event between completion notification and promise cleanup is not lost", async () => {
    const watcher = new ManualWatcher();
    let calls = 0;
    const lifecycle = own(
      new WatchLifecycle(async () => ++calls, {
        watcher,
        debounceMs: 1,
        rescanIntervalMs: 0,
        onComplete: (report) => {
          if (report === 2) queueMicrotask(() => watcher.change());
        },
      }),
    );
    await lifecycle.start();
    expect(await lifecycle.resync()).toBe(2);
    await eventually(() => calls === 3 && !lifecycle.syncing);
    expect(lifecycle.dirty).toBe(false);
  });

  test("failed watcher startup closes installed resources without beginning a scan", async () => {
    const watcher = new ManualWatcher(false);
    let calls = 0;
    const lifecycle = own(
      new WatchLifecycle(async () => ++calls, { watcher, rescanIntervalMs: 0 }),
    );
    const failure = new Error("Watcher installation failed");
    const starting = lifecycle.start();
    watcher.ready.reject(failure);
    await expect(starting).rejects.toBe(failure);
    expect(watcher.closed).toBe(true);
    expect(calls).toBe(0);
    lifecycle.requestResync();
    await expect(lifecycle.resync()).rejects.toBeInstanceOf(WatchStoppedError);
    await lifecycle.shutdown();
    expect(watcher.closeCalls).toBe(1);
  });

  test("shutdown while readiness is pending releases startup without a reconciliation", async () => {
    const watcher = new ManualWatcher(false);
    let calls = 0;
    const lifecycle = own(
      new WatchLifecycle(async () => ++calls, { watcher, rescanIntervalMs: 0 }),
    );
    const starting = lifecycle.start().catch((error: unknown) => error);
    await lifecycle.shutdown();
    expect(await starting).toBeInstanceOf(WatcherClosedError);
    expect(calls).toBe(0);
    expect(watcher.closeCalls).toBe(1);
  });

  test("a failed reconciliation does not poison later explicit requests", async () => {
    let calls = 0;
    const failure = new Error("A rebuildable cache was unavailable");
    const lifecycle = own(
      new WatchLifecycle(
        async () => {
          const current = ++calls;
          if (current === 2) throw failure;
          return current;
        },
        { rescanIntervalMs: 0 },
      ),
    );
    await lifecycle.start();
    await expect(lifecycle.resync()).rejects.toBe(failure);
    expect(lifecycle.syncing).toBe(false);
    expect(await lifecycle.resync()).toBe(3);
  });

  test("observer failures are reported without breaking reconciliation or event delivery", async () => {
    const watcher = new ManualWatcher();
    const errors: unknown[] = [];
    let calls = 0;
    const lifecycle = own(
      new WatchLifecycle(async () => ++calls, {
        watcher,
        debounceMs: 0,
        rescanIntervalMs: 0,
        onChange: () => {
          throw new Error("Change observer failed");
        },
        onComplete: (report) => {
          if (report > 1) throw new Error("Completion observer failed");
        },
        onError: (error) => {
          errors.push(error);
          throw new Error("Host logger also failed");
        },
      }),
    );
    await lifecycle.start();
    expect(() => watcher.change()).not.toThrow();
    await eventually(() => calls === 2 && !lifecycle.syncing);
    expect(errors).toHaveLength(2);
    expect(await lifecycle.resync()).toBe(3);
    expect(errors).toHaveLength(3);
  });

  test("shutdown drains failing work and ignores requests and watcher callbacks after stopping", async () => {
    const watcher = new ManualWatcher();
    const entered = deferred<void>();
    const finish = deferred<void>();
    releases.push(() => finish.resolve());
    let calls = 0;
    let active = false;
    const failure = new Error("Held reconciliation failed");
    const lifecycle = own(
      new WatchLifecycle(
        async () => {
          const current = ++calls;
          if (current === 1) return current;
          active = true;
          entered.resolve();
          try {
            await finish.promise;
            throw failure;
          } finally {
            active = false;
          }
        },
        { watcher, debounceMs: 0, rescanIntervalMs: 0 },
      ),
    );
    await lifecycle.start();
    const pending = lifecycle.resync().catch((error: unknown) => error);
    await entered.promise;
    let closed = false;
    const closing = lifecycle.shutdown().then(() => {
      closed = true;
    });
    lifecycle.requestResync();
    watcher.change();
    await delay(5);
    expect(closed).toBe(false);
    expect(active).toBe(true);
    finish.resolve();
    await closing;
    expect(await pending).toBe(failure);
    expect(active).toBe(false);
    expect(calls).toBe(2);
    expect(watcher.closeCalls).toBe(1);
    expect(lifecycle.shutdown()).toBe(lifecycle.shutdown());
    await expect(lifecycle.start()).rejects.toBeInstanceOf(WatchStoppedError);
  });

  test("periodic fallback works without filesystem notifications and stops at shutdown", async () => {
    let calls = 0;
    const lifecycle = own(
      new WatchLifecycle(async () => ++calls, { debounceMs: 0, rescanIntervalMs: 10 }),
    );
    expect(await lifecycle.start()).toBe(1);
    await eventually(() => calls >= 2);
    await lifecycle.shutdown();
    const final = calls;
    await delay(30);
    expect(calls).toBe(final);
  });

  test("periodic recovery progresses when the debounce is longer than the rescan interval", async () => {
    let calls = 0;
    const lifecycle = own(
      new WatchLifecycle(async () => ++calls, { debounceMs: 100, rescanIntervalMs: 10 }),
    );
    expect(await lifecycle.start()).toBe(1);
    await eventually(() => calls >= 3);
    await eventually(() => !lifecycle.dirty);
    await lifecycle.shutdown();
    const final = calls;
    await delay(30);
    expect(calls).toBe(final);
  });

  test("periodic recovery never overlaps passes and still follows a change made during a pass", async () => {
    let calls = 0;
    let active = 0;
    let peak = 0;
    let lifecycle!: WatchLifecycle<number>;
    lifecycle = own(
      new WatchLifecycle(
        async () => {
          const current = ++calls;
          peak = Math.max(peak, ++active);
          try {
            if (current === 1) lifecycle.requestResync();
            await delay(5);
            return current;
          } finally {
            active--;
          }
        },
        { debounceMs: 100, rescanIntervalMs: 10 },
      ),
    );
    expect(await lifecycle.start()).toBe(2);
    // Wait until a pass driven by the periodic timer has actually run, so the
    // overlap assertion below covers a periodic pass and not only the startup
    // pass and its follow-up.
    await eventually(() => calls >= 3);
    expect(peak).toBe(1);
    await lifecycle.shutdown();
  });

  test("a watcher close failure is returned only after active reconciliation has drained", async () => {
    const entered = deferred<void>();
    const finish = deferred<void>();
    releases.push(() => finish.resolve());
    const failure = new Error("Watcher backend failed to close");
    const watcher: WatchSource = {
      start: async () => {},
      close: async () => {
        throw failure;
      },
    };
    let calls = 0;
    let active = false;
    const lifecycle = own(
      new WatchLifecycle(
        async () => {
          const current = ++calls;
          if (current === 2) {
            active = true;
            entered.resolve();
            await finish.promise;
            active = false;
          }
          return current;
        },
        { watcher, rescanIntervalMs: 0 },
      ),
    );
    await lifecycle.start();
    const pending = lifecycle.resync();
    await entered.promise;
    let settled = false;
    const closing = lifecycle.shutdown().catch((error: unknown) => {
      settled = true;
      return error;
    });
    await delay(5);
    expect(active).toBe(true);
    expect(settled).toBe(false);
    finish.resolve();
    expect(await closing).toBe(failure);
    expect(await pending).toBe(2);
    expect(active).toBe(false);
  });

  test("an already cancelled waiter never starts new reconciliation work", async () => {
    let calls = 0;
    const lifecycle = own(new WatchLifecycle(async () => ++calls, { rescanIntervalMs: 0 }));
    const controller = new AbortController();
    const reason = new DOMException("Already cancelled", "AbortError");
    controller.abort(reason);
    await expect(lifecycle.resync(controller.signal)).rejects.toBe(reason);
    expect(calls).toBe(0);
    expect(await lifecycle.start()).toBe(1);
  });
});

describe("complete snapshot reconciliation", () => {
  test("partial scans update valid entries while preserving unknown cached identities", () => {
    const rows = new Map([
      ["changed", "old"],
      ["unchanged", "same"],
      ["unseen", "retained"],
    ]);
    let removalCalls = 0;
    const target = {
      key: (entry: { key: string; checksum: string }) => entry.key,
      upsert: (entry: { key: string; checksum: string }) => {
        if (rows.get(entry.key) === entry.checksum) return false;
        rows.set(entry.key, entry.checksum);
        return true;
      },
      removeMissing: (keys: Iterable<string>) => {
        removalCalls++;
        const present = new Set(keys);
        let removed = 0;
        for (const key of rows.keys())
          if (!present.has(key)) {
            rows.delete(key);
            removed++;
          }
        return removed;
      },
    };
    const entries = [
      { key: "changed", checksum: "new" },
      { key: "unchanged", checksum: "same" },
    ];
    expect(reconcileSnapshot({ entries, complete: false }, target)).toEqual({
      indexed: 1,
      unchanged: 1,
      deleted: 0,
    });
    expect(rows.get("unseen")).toBe("retained");
    expect(removalCalls).toBe(0);
    expect(reconcileSnapshot({ entries, complete: true }, target)).toEqual({
      indexed: 0,
      unchanged: 2,
      deleted: 1,
    });
    expect(rows.has("unseen")).toBe(false);
    expect(removalCalls).toBe(1);
  });

  test("an incomplete snapshot invalidates a confirmed conflict without removing unseen rows", () => {
    const rows = new Map([
      ["conflicted", "checksum"],
      ["unseen", "retained"],
    ]);
    const target = {
      key: (entry: { key: string }) => entry.key,
      upsert: (entry: { key: string; checksum: string }) => {
        rows.set(entry.key, entry.checksum);
        return true;
      },
      removeMissing: () => {
        throw new Error("An incomplete snapshot must not remove missing rows.");
      },
      invalidate: (keys: Iterable<string>) => {
        let removed = 0;
        for (const key of keys) if (rows.delete(key)) removed++;
        return removed;
      },
    };
    const result = reconcileSnapshot(
      {
        entries: [{ key: "observed", checksum: "new" }],
        complete: false,
        invalidated: ["conflicted"],
      },
      target,
    );
    expect(result).toEqual({ indexed: 1, unchanged: 0, deleted: 1 });
    expect(rows.has("conflicted")).toBe(false);
    expect(rows.get("unseen")).toBe("retained");
  });

  test("duplicate snapshot identities fail before any cache mutation or removal", () => {
    let mutations = 0;
    expect(() =>
      reconcileSnapshot(
        {
          entries: [
            { key: "same", checksum: "first" },
            { key: "same", checksum: "second" },
          ],
          complete: true,
        },
        {
          key: (entry) => entry.key,
          upsert: () => {
            mutations++;
            return true;
          },
          removeMissing: () => {
            mutations++;
            return 1;
          },
        },
      ),
    ).toThrow(ReconciliationIdentityError);
    expect(mutations).toBe(0);
  });

  test("a failed upsert cannot be followed by a destructive missing-item pass", () => {
    let removals = 0;
    expect(() =>
      reconcileSnapshot(
        { entries: [{ key: "present" }], complete: true },
        {
          key: (entry) => entry.key,
          upsert: () => {
            throw new Error("Cache write failed");
          },
          removeMissing: () => ++removals,
        },
      ),
    ).toThrow("Cache write failed");
    expect(removals).toBe(0);
  });
});

describe("filesystem watch source", () => {
  test("publishes relative Markdown and directory events while excluding hidden and unrelated files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "object-mcp-vault-watch-"));
    directories.push(root);
    await mkdir(path.join(root, "documents"));
    const events: FileChange[] = [];
    const errors: unknown[] = [];
    const watcher = new FileWatcher({
      root,
      stabilityThresholdMs: 20,
      pollIntervalMs: 5,
    });
    cleanup.push(() => watcher.close());
    await watcher.start({
      onChange: (change) => events.push(change),
      onError: (error) => errors.push(error),
    });
    expect(watcher.isWatching).toBe(true);
    await Promise.all([
      writeFile(path.join(root, "documents", "object.MD"), "Markdown"),
      writeFile(path.join(root, "documents", "notes.txt"), "Unrelated"),
      writeFile(path.join(root, "documents", ".owned-stage.md"), "Private"),
      mkdir(path.join(root, "new-directory")),
    ]);
    await eventually(
      () =>
        events.some((event) => event.path === "documents/object.MD") &&
        events.some((event) => event.path === "new-directory" && event.event === "addDir"),
    );
    await delay(30);
    expect(events.every((event) => !path.isAbsolute(event.path))).toBe(true);
    expect(events.some((event) => event.path.endsWith("notes.txt"))).toBe(false);
    expect(events.some((event) => event.path.includes(".owned-stage"))).toBe(false);
    expect(errors).toEqual([]);
    await watcher.close();
    expect(watcher.isWatching).toBe(false);
    await expect(watcher.start({ onChange: () => {}, onError: () => {} })).rejects.toBeInstanceOf(
      WatcherClosedError,
    );
  });

  test("closing an actual watcher before readiness releases the pending start promise", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "object-mcp-vault-watch-startup-"));
    directories.push(root);
    const watcher = new FileWatcher({ root });
    cleanup.push(() => watcher.close());
    const starting = watcher
      .start({ onChange: () => {}, onError: () => {} })
      .catch((error: unknown) => error);
    await watcher.close();
    expect(await starting).toBeInstanceOf(WatcherClosedError);
    expect(watcher.isWatching).toBe(false);
  });
});
