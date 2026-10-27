import type { FileChange, WatchSource } from "./watcher.ts";

export class WatchStoppedError extends Error {
  constructor() {
    super("Vault reconciliation is closing or closed.");
    this.name = "WatchStoppedError";
  }
}

export interface WatchLifecycleOptions<Report> {
  readonly watcher?: WatchSource | undefined;
  readonly debounceMs?: number;
  readonly rescanIntervalMs?: number;
  readonly maxPasses?: number;
  readonly onChange?: (change: FileChange) => void;
  readonly onComplete?: (report: Report) => void;
  readonly onError?: (error: unknown) => void;
}

/** Owns automatic reconciliation and its waiters; the host owns cancellation of the actual work. */
export class WatchLifecycle<Report> {
  private readonly debounceMs: number;
  private readonly rescanIntervalMs: number;
  private readonly maxPasses: number;
  private running: Promise<Report> | undefined;
  private startPromise: Promise<Report> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private periodic: ReturnType<typeof setInterval> | undefined;
  private changed = false;
  private started = false;
  private stopped = false;

  constructor(
    private readonly reconcile: () => Promise<Report>,
    private readonly options: WatchLifecycleOptions<Report> = {},
  ) {
    this.debounceMs = options.debounceMs ?? 100;
    this.rescanIntervalMs = options.rescanIntervalMs ?? 60_000;
    this.maxPasses = options.maxPasses ?? 5;
    for (const value of [this.debounceMs, this.rescanIntervalMs])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError("Reconciliation intervals must be nonnegative integers.");
    if (!Number.isSafeInteger(this.maxPasses) || this.maxPasses < 1)
      throw new TypeError("The maximum reconciliation pass count must be a positive integer.");
  }

  get syncing(): boolean {
    return this.running !== undefined;
  }

  get dirty(): boolean {
    return this.changed;
  }

  private ensureOpen(): void {
    if (this.stopped) throw new WatchStoppedError();
  }

  private reportError(error: unknown): void {
    try {
      this.options.onError?.(error);
    } catch {
      // An observer failure must not poison the scheduling chain or resource cleanup.
    }
  }

  start(): Promise<Report> {
    if (this.stopped) return Promise.reject(new WatchStoppedError());
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initialize();
    return this.startPromise;
  }

  private async initialize(): Promise<Report> {
    try {
      await this.options.watcher?.start({
        onChange: (change) => {
          if (this.stopped) return;
          try {
            this.options.onChange?.(change);
          } catch (error) {
            this.reportError(error);
          }
          this.requestResync();
        },
        onError: (error) => {
          if (this.stopped) return;
          this.reportError(error);
          this.requestResync();
        },
      });
    } catch (error) {
      this.stopped = true;
      this.stopTimers();
      await this.options.watcher?.close().catch(() => undefined);
      throw error;
    }
    this.ensureOpen();
    this.started = true;
    try {
      const report = await this.resync();
      this.ensureOpen();
      this.startPeriodicResync();
      return report;
    } catch (error) {
      if (!this.stopped) this.startPeriodicResync();
      throw error;
    }
  }

  private startPeriodicResync(): void {
    if (this.rescanIntervalMs > 0 && !this.stopped && !this.periodic) {
      this.periodic = setInterval(() => this.requestPeriodicResync(), this.rescanIntervalMs);
      this.periodic.unref();
    }
  }

  /**
   * Periodic recovery must not wait for the event debounce: a debounce longer than the
   * rescan interval would otherwise reset the pending timer on every tick forever.
   */
  private requestPeriodicResync(): void {
    if (this.stopped) return;
    this.changed = true;
    // A running pass observes the change itself and repeats while it stays dirty.
    if (!this.started || this.running) return;
    void this.resync().catch((error: unknown) => {
      if (!this.stopped) this.reportError(error);
    });
  }

  requestResync(): void {
    if (this.stopped) return;
    this.changed = true;
    if (!this.started || this.running) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.resync().catch((error) => {
        if (!this.stopped) this.reportError(error);
      });
    }, this.debounceMs);
    this.debounce.unref();
  }

  resync(signal?: AbortSignal): Promise<Report> {
    if (this.stopped) return Promise.reject(new WatchStoppedError());
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!this.running) {
      if (this.debounce) {
        clearTimeout(this.debounce);
        this.debounce = undefined;
      }
      this.running = Promise.resolve()
        .then(async () => {
          this.ensureOpen();
          this.changed = false;
          let report = await this.reconcile();
          for (let pass = 1; pass < this.maxPasses && this.changed && !this.stopped; pass++) {
            this.changed = false;
            report = await this.reconcile();
          }
          if (!this.stopped) {
            try {
              this.options.onComplete?.(report);
            } catch (error) {
              this.reportError(error);
            }
          }
          return report;
        })
        .finally(() => {
          this.running = undefined;
          if (this.changed) this.requestResync();
        });
    }
    return waitForShared(this.running, signal);
  }

  private stopTimers(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.periodic) clearInterval(this.periodic);
    this.debounce = undefined;
    this.periodic = undefined;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopped = true;
    this.stopTimers();
    const closingWatcher = Promise.resolve().then(() => this.options.watcher?.close());
    this.shutdownPromise = (async () => {
      const [watcher] = await Promise.allSettled([
        closingWatcher,
        ...(this.startPromise ? [this.startPromise] : []),
        ...(this.running ? [this.running] : []),
      ]);
      if (watcher?.status === "rejected") throw watcher.reason;
    })();
    return this.shutdownPromise;
  }
}

export function waitForShared<Value>(
  promise: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
