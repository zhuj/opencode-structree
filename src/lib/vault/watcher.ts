import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

export interface FileChange {
  readonly event: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  readonly path: string;
}

export interface WatchCallbacks {
  readonly onChange: (change: FileChange) => void;
  readonly onError: (error: unknown) => void;
}

export interface WatchSource {
  start(callbacks: WatchCallbacks): Promise<void>;
  close(): Promise<void>;
}

export interface FileWatcherOptions {
  readonly root: string;
  readonly extensions?: readonly string[];
  readonly stabilityThresholdMs?: number;
  readonly pollIntervalMs?: number;
  readonly ignored?: (relativePath: string) => boolean;
}

export class WatcherClosedError extends Error {
  constructor() {
    super("The file watcher is closing or closed.");
    this.name = "WatcherClosedError";
  }
}

export class FileWatcher implements WatchSource {
  readonly root: string;
  private readonly extensions: readonly string[];
  private watcher: FSWatcher | undefined;
  private callbacks: WatchCallbacks | undefined;
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private rejectStartup: ((reason: unknown) => void) | undefined;
  private ready = false;
  private closed = false;

  constructor(private readonly options: FileWatcherOptions) {
    this.root = path.resolve(options.root);
    this.extensions = (options.extensions ?? [".md"]).map((extension) => {
      if (!extension.startsWith(".") || extension.length < 2 || /[\\/]/.test(extension))
        throw new TypeError("Watched extensions must be filename suffixes beginning with a dot.");
      return extension.toLowerCase();
    });
    for (const value of [options.stabilityThresholdMs ?? 100, options.pollIntervalMs ?? 50])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new TypeError("Watcher intervals must be positive integers.");
  }

  get isWatching(): boolean {
    return this.ready && !this.closed;
  }

  private relative(filename: string): string | undefined {
    const relative = path.relative(this.root, filename);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return undefined;
    return relative.split(path.sep).join("/");
  }

  private ignored(filename: string): boolean {
    const relative = this.relative(filename);
    return (
      relative === undefined ||
      relative.split("/").some((part) => part.startsWith(".")) ||
      (this.options.ignored?.(relative) ?? false)
    );
  }

  private reportError(error: unknown): void {
    try {
      this.callbacks?.onError(error);
    } catch {
      // Host diagnostics must not escape an EventEmitter callback or strand watcher cleanup.
    }
  }

  start(callbacks: WatchCallbacks): Promise<void> {
    if (this.closed) return Promise.reject(new WatcherClosedError());
    if (this.startPromise) return this.startPromise;
    this.callbacks = callbacks;
    const starting = new Promise<void>((resolve, reject) => {
      this.rejectStartup = reject;
      this.watcher = chokidar.watch(this.root, {
        ignoreInitial: true,
        persistent: true,
        followSymlinks: false,
        ignored: (filename) => this.ignored(filename),
        awaitWriteFinish: {
          stabilityThreshold: this.options.stabilityThresholdMs ?? 100,
          pollInterval: this.options.pollIntervalMs ?? 50,
        },
      });
      this.watcher.on("all", (event, filename) => {
        if (this.closed || this.ignored(filename)) return;
        if (
          event !== "add" &&
          event !== "change" &&
          event !== "unlink" &&
          event !== "addDir" &&
          event !== "unlinkDir"
        )
          return;
        if (
          event !== "addDir" &&
          event !== "unlinkDir" &&
          !this.extensions.some((extension) => filename.toLowerCase().endsWith(extension))
        )
          return;
        const relative = this.relative(filename);
        if (relative === undefined) return;
        try {
          this.callbacks?.onChange({ event, path: relative });
        } catch (error) {
          this.reportError(error);
        }
      });
      this.watcher.on("error", (error) => {
        this.rejectStartup?.(error);
        this.rejectStartup = undefined;
        this.reportError(error);
      });
      this.watcher.once("ready", () => {
        if (this.closed) return;
        this.ready = true;
        this.rejectStartup = undefined;
        resolve();
      });
    });
    this.startPromise = starting.catch(async (error: unknown) => {
      await this.close().catch(() => undefined);
      throw error;
    });
    return this.startPromise;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.ready = false;
    this.rejectStartup?.(new WatcherClosedError());
    this.rejectStartup = undefined;
    this.callbacks = undefined;
    this.closePromise = Promise.resolve().then(() => this.watcher?.close());
    return this.closePromise;
  }
}
