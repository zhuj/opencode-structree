import { constants, type Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import path from "node:path";
import { FrameworkError } from "../errors.ts";
import { checksum } from "./checksums.ts";
import {
  ConfinedDirectory,
  errorCode,
  pathComponents,
  sameIdentity,
} from "./confined-directory.ts";
import { OwnedStage } from "./owned-stage.ts";
import { retrySourceFileOperation } from "./source-read-retry.ts";
import { assertUtf8Text } from "./utf8.ts";

export type ReadBufferOperation = (
  handle: FileHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
) => Promise<{ readonly bytesRead: number }>;

const defaultReadBuffer: ReadBufferOperation = (handle, buffer, offset, length, position) =>
  handle.read(buffer, offset, length, position);

export interface ConfinedFilesystemOptions {
  readonly maxFileBytes?: number;
  readonly confinement?: "auto" | "descriptor" | "portable";
  readonly readOnly?: boolean;
  readonly createRoot?: boolean;
  /** Positional file-content read adapter; only accepted for read-only instances. */
  readonly readBuffer?: ReadBufferOperation;
}

export interface VaultFile {
  readonly path: string;
  readonly raw: string;
  readonly checksum: string;
}

export interface VaultIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface VaultWalkResult {
  readonly files: readonly VaultFile[];
  readonly issues: readonly VaultIssue[];
  readonly complete: boolean;
  readonly scanned: number;
}

export interface WriteExpectation {
  /** null requires an absent destination; a checksum requires exactly those existing bytes. */
  readonly expectedChecksum: string | null;
}

export type BasenameRenameResult = "renamed" | "equivalent";

export class ConfinedFilesystem {
  readonly maxFileBytes: number;
  private directoryRoot: ConfinedDirectory | undefined;
  private initialization: Promise<void> | undefined;
  private stopping = false;
  private leases = 0;
  private drained: (() => void) | undefined;
  private closeResult: Promise<void> | undefined;
  private mutationTail = Promise.resolve();
  private readonly stages = new WeakSet<OwnedStage>();
  private readonly requestedConfinement: "auto" | "descriptor" | "portable";
  private readonly readOnly: boolean;
  private readonly createRoot: boolean;
  private readonly readBuffer: ReadBufferOperation;

  constructor(
    readonly configuredRoot: string,
    options: ConfinedFilesystemOptions = {},
  ) {
    if (!configuredRoot || configuredRoot.includes("\0"))
      throw new FrameworkError("PATH", "Vault root must be a nonempty filesystem path.");
    assertUtf8Text(configuredRoot);
    this.maxFileBytes = options.maxFileBytes ?? 5_000_000;
    this.requestedConfinement = options.confinement ?? "auto";
    this.readOnly = options.readOnly ?? false;
    this.createRoot = !this.readOnly && (options.createRoot ?? true);
    if (options.readBuffer && !this.readOnly)
      throw new FrameworkError(
        "CONFIG",
        "A custom read-buffer operation requires read-only access.",
      );
    this.readBuffer = options.readBuffer ?? defaultReadBuffer;
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < 1)
      throw new FrameworkError("CONFIG", "Vault maxFileBytes must be a positive safe integer.");
  }

  get root(): string {
    return this.directoryRoot?.absolute ?? path.resolve(this.configuredRoot);
  }

  get confinement(): "descriptor" | "path" {
    return this.directoryRoot?.descriptors ? "descriptor" : "path";
  }

  initialize(): Promise<void> {
    if (this.stopping) return Promise.reject(new FrameworkError("CLOSED", "Vault is closed."));
    this.initialization ??= this.openRoot();
    return this.initialization;
  }

  private async openRoot(): Promise<void> {
    if (this.createRoot) await fs.mkdir(this.configuredRoot, { recursive: true });
    const absolute = await fs.realpath(this.configuredRoot);
    let descriptors = false;
    if (
      this.requestedConfinement !== "portable" &&
      process.platform === "linux" &&
      constants.O_DIRECTORY &&
      constants.O_NOFOLLOW
    ) {
      try {
        descriptors = (await fs.statfs("/proc/self/fd")).type === 0x9fa0;
      } catch {
        descriptors = false;
      }
    }
    if (this.requestedConfinement === "descriptor" && !descriptors)
      throw new FrameworkError(
        "CONFIG",
        "Descriptor vault confinement requires Linux with procfs.",
      );
    const handle = await fs.open(
      absolute,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      if (!(await handle.stat()).isDirectory())
        throw new FrameworkError("PATH", "Vault root must be a directory.");
      this.directoryRoot = new ConfinedDirectory(absolute, handle, descriptors);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  absolute(relative: string): string {
    return path.join(this.root, ...pathComponents(relative));
  }

  private async retain(): Promise<() => void> {
    await this.initialize();
    if (this.stopping) throw new FrameworkError("CLOSED", "Vault is closing.");
    this.leases++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.leases--;
      if (this.leases === 0) this.drained?.();
    };
  }

  private async directory(parts: readonly string[], create: boolean): Promise<ConfinedDirectory> {
    const root = this.directoryRoot;
    if (!root) throw new FrameworkError("CLOSED", "Vault is not initialized.");
    await root.verify();
    const handle = await fs.open(
      root.anchor,
      constants.O_RDONLY |
        (constants.O_DIRECTORY ?? 0) |
        (root.descriptors ? 0 : (constants.O_NOFOLLOW ?? 0)),
    );
    let current = new ConfinedDirectory(root.absolute, handle, root.descriptors);
    try {
      if (!sameIdentity(await handle.stat(), await root.handle.stat()))
        throw new FrameworkError("PATH", "Vault root identity changed.");
      for (const part of parts) {
        const child = await current.open(part, create);
        await current.close();
        current = child;
      }
      return current;
    } catch (error) {
      await current.close();
      throw error;
    }
  }

  async ensureDirectory(relative: string, create = true): Promise<string> {
    if (create) this.assertWritable();
    const parts = pathComponents(relative, true);
    const release = await this.retain();
    try {
      const directory = await this.directory(parts, create);
      try {
        return directory.absolute;
      } finally {
        await directory.close();
      }
    } finally {
      release();
    }
  }

  private async parent<T>(
    relative: string,
    create: boolean,
    use: (parent: ConfinedDirectory, name: string) => Promise<T>,
  ): Promise<T> {
    const parts = pathComponents(relative);
    const name = parts.pop();
    if (!name) throw new FrameworkError("PATH", "Missing vault filename.");
    const release = await this.retain();
    try {
      const parent = await this.directory(parts, create);
      try {
        return await use(parent, name);
      } finally {
        await parent.close();
      }
    } finally {
      release();
    }
  }

  private async readFrom(
    parent: ConfinedDirectory,
    name: string,
    relative: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Buffer; mode: number }> {
    signal?.throwIfAborted();
    const before = await fs.lstat(parent.child(name));
    if (before.isSymbolicLink() || !before.isFile())
      throw new FrameworkError("PATH", `Vault path must be a regular file: ${relative}`);
    const handle = await retrySourceFileOperation(() =>
      fs.open(
        parent.child(name),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      ),
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameIdentity(before, opened))
        throw new FrameworkError("PATH", `Vault file changed while it was opened: ${relative}`);
      if (opened.size > this.maxFileBytes) this.tooLarge(relative);
      const pieces: Buffer[] = [];
      let size = 0;
      while (size <= this.maxFileBytes) {
        signal?.throwIfAborted();
        const buffer = Buffer.alloc(Math.min(64 * 1024, this.maxFileBytes + 1 - size));
        const { bytesRead } = await retrySourceFileOperation(() =>
          this.readBuffer(handle, buffer, 0, buffer.length, size),
        );
        if (!bytesRead) break;
        pieces.push(buffer.subarray(0, bytesRead));
        size += bytesRead;
      }
      if (size > this.maxFileBytes) this.tooLarge(relative);
      return { bytes: Buffer.concat(pieces, size), mode: opened.mode };
    } finally {
      await handle.close();
    }
  }

  private tooLarge(relative: string): never {
    throw new FrameworkError(
      "FILE_TOO_LARGE",
      `Vault file exceeds maxFileBytes (${this.maxFileBytes}): ${relative}`,
    );
  }

  private decode(bytes: Uint8Array, relative: string): string {
    try {
      // A BOM participates in the checksum even though the Markdown codec ignores it as syntax.
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      throw new FrameworkError(
        "ENCODING",
        `Vault file is not valid UTF-8: ${relative}`,
        {},
        {
          cause: error,
        },
      );
    }
  }

  async readText(relative: string, signal?: AbortSignal): Promise<string> {
    return this.parent(relative, false, async (parent, name) =>
      this.decode((await this.readFrom(parent, name, relative, signal)).bytes, relative),
    );
  }

  async readBytes(relative: string, signal?: AbortSignal): Promise<Uint8Array> {
    return this.parent(relative, false, async (parent, name) =>
      Buffer.from((await this.readFrom(parent, name, relative, signal)).bytes),
    );
  }

  async hash(relative: string, signal?: AbortSignal): Promise<string | null> {
    try {
      return await this.parent(relative, false, async (parent, name) =>
        checksum((await this.readFrom(parent, name, relative, signal)).bytes),
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  async stage(relative: string, raw: string, signal?: AbortSignal): Promise<OwnedStage> {
    this.assertWritable();
    signal?.throwIfAborted();
    if (typeof raw !== "string")
      throw new FrameworkError("VALIDATION", "Vault content must be a string.");
    assertUtf8Text(raw);
    if (Buffer.byteLength(raw, "utf8") > this.maxFileBytes) this.tooLarge(relative);
    return this.stagePayload(relative, raw, signal);
  }

  async stageBytes(relative: string, bytes: Uint8Array, signal?: AbortSignal): Promise<OwnedStage> {
    this.assertWritable();
    signal?.throwIfAborted();
    const snapshot = Buffer.from(bytes);
    if (snapshot.byteLength > this.maxFileBytes) this.tooLarge(relative);
    return this.stagePayload(relative, snapshot, signal);
  }

  private async stagePayload(
    relative: string,
    payload: string | Uint8Array,
    signal?: AbortSignal,
  ): Promise<OwnedStage> {
    signal?.throwIfAborted();
    const parts = pathComponents(relative);
    parts.pop();
    const release = await this.retain();
    let parent: ConfinedDirectory;
    try {
      parent = await this.directory(parts, true);
    } catch (error) {
      release();
      throw error;
    }
    const stage = await OwnedStage.create(relative, payload, parent, release);
    this.stages.add(stage);
    return stage;
  }

  async publish(
    stage: OwnedStage,
    expectation: WriteExpectation,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertWritable();
    if (!this.stages.delete(stage))
      throw new FrameworkError("STAGE", "Vault stage is foreign or has already been consumed.");
    return this.mutate(() => this.publishStage(stage, expectation, signal));
  }

  private async publishStage(
    stage: OwnedStage,
    expectation: WriteExpectation,
    signal?: AbortSignal,
  ): Promise<void> {
    if (expectation.expectedChecksum !== null && typeof expectation.expectedChecksum !== "string")
      throw new FrameworkError(
        "VALIDATION",
        "Vault writes require an explicit checksum expectation.",
      );
    let mode: number | undefined;
    if (expectation.expectedChecksum !== null) {
      try {
        mode = await this.parent(stage.path, false, async (parent, name) => {
          const current = await this.readFrom(parent, name, stage.path, signal);
          const actualChecksum = checksum(current.bytes);
          if (actualChecksum !== expectation.expectedChecksum)
            throw new FrameworkError(
              "CHECKSUM_CONFLICT",
              "The vault file changed since it was read.",
              {
                actualChecksum,
              },
            );
          return current.mode;
        });
      } catch (error) {
        if (errorCode(error) === "ENOENT")
          throw new FrameworkError(
            "CHECKSUM_CONFLICT",
            "The vault file was removed since it was read.",
            {
              actualChecksum: null,
            },
          );
        throw error;
      }
    }
    signal?.throwIfAborted();
    try {
      await stage.publish(expectation.expectedChecksum === null, mode);
    } catch (error) {
      if (errorCode(error) === "EEXIST")
        throw new FrameworkError("ALREADY_EXISTS", "The target vault file already exists.");
      throw error;
    }
  }

  async write(
    relative: string,
    raw: string,
    expectation: WriteExpectation,
    signal?: AbortSignal,
  ): Promise<void> {
    const stage = await this.stage(relative, raw, signal);
    try {
      await this.publish(stage, expectation, signal);
    } finally {
      await stage.cleanup();
    }
  }

  async writeBytes(
    relative: string,
    bytes: Uint8Array,
    expectation: WriteExpectation,
    signal?: AbortSignal,
  ): Promise<void> {
    const stage = await this.stageBytes(relative, bytes, signal);
    try {
      await this.publish(stage, expectation, signal);
    } finally {
      await stage.cleanup();
    }
  }

  /** Link publication is exclusive, unlike rename(), which can overwrite a destination. */
  async renameBasename(
    relative: string,
    basename: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<BasenameRenameResult> {
    this.assertWritable();
    if (pathComponents(basename).length !== 1)
      throw new FrameworkError("PATH", "A rename must stay in the same directory.");
    return this.mutate(() =>
      this.parent<BasenameRenameResult>(relative, false, async (parent, name) => {
        const current = await this.readFrom(parent, name, relative, signal);
        if (checksum(current.bytes) !== expectedChecksum)
          throw new FrameworkError(
            "CHECKSUM_CONFLICT",
            "The vault file changed since it was read.",
          );
        signal?.throwIfAborted();
        await parent.verify();
        try {
          const target = await fs.lstat(parent.child(basename));
          const source = await fs.lstat(parent.child(name));
          if (source.isFile() && target.isFile() && sameIdentity(source, target))
            return "equivalent";
        } catch (error) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
        await fs.link(parent.child(name), parent.child(basename));
        try {
          await fs.unlink(parent.child(name));
        } catch (error) {
          await fs.unlink(parent.child(basename));
          throw error;
        }
        await parent.sync();
        return "renamed";
      }),
    );
  }

  async delete(relative: string, expectedChecksum: string, signal?: AbortSignal): Promise<void> {
    this.assertWritable();
    await this.mutate(() =>
      this.parent(relative, false, async (parent, name) => {
        const current = await this.readFrom(parent, name, relative, signal);
        const actualChecksum = checksum(current.bytes);
        if (actualChecksum !== expectedChecksum)
          throw new FrameworkError(
            "CHECKSUM_CONFLICT",
            "The vault file changed since it was read.",
            {
              actualChecksum,
            },
          );
        signal?.throwIfAborted();
        await parent.verify();
        await fs.unlink(parent.child(name));
        await parent.sync();
      }),
    );
  }

  private mutate<A>(work: () => Promise<A>): Promise<A> {
    const result = this.mutationTail.then(work);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertWritable(): void {
    if (this.readOnly) throw new FrameworkError("READ_ONLY", "Vault filesystem is read-only.");
  }

  async walk(relative = "", signal?: AbortSignal): Promise<VaultWalkResult> {
    const parts = pathComponents(relative, true);
    const release = await this.retain();
    const files: VaultFile[] = [];
    const issues: VaultIssue[] = [];
    let complete = true;
    let scanned = 0;
    const issue = (candidate: string, error: unknown, code = "READ") => {
      issues.push({
        path: candidate,
        code: error instanceof FrameworkError ? error.code : code,
        message: error instanceof Error ? error.message : String(error),
      });
    };
    const walk = async (directory: ConfinedDirectory, prefix: string): Promise<void> => {
      signal?.throwIfAborted();
      let entries: Dirent[];
      try {
        entries = await fs.readdir(directory.anchor, { withFileTypes: true });
      } catch (error) {
        complete = false;
        issue(prefix, error, "SCAN");
        return;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.name.startsWith(".")) continue;
        const candidate = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) {
          issues.push({
            path: candidate,
            code: "SYMLINK",
            message: "Symlinks are excluded from vault storage.",
          });
        } else if (entry.isDirectory()) {
          try {
            const child = await directory.open(entry.name);
            try {
              await walk(child, candidate);
            } finally {
              await child.close();
            }
          } catch (error) {
            signal?.throwIfAborted();
            if (errorCode(error) === "ENOENT") continue;
            complete = false;
            issue(candidate, error, "DIRECTORY");
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          scanned++;
          try {
            const { bytes } = await this.readFrom(directory, entry.name, candidate, signal);
            files.push({
              path: candidate,
              raw: this.decode(bytes, candidate),
              checksum: checksum(bytes),
            });
          } catch (error) {
            signal?.throwIfAborted();
            if (errorCode(error) !== "ENOENT") issue(candidate, error);
          }
        }
      }
    };
    try {
      let directory: ConfinedDirectory;
      try {
        directory = await this.directory(parts, false);
      } catch (error) {
        signal?.throwIfAborted();
        if (errorCode(error) !== "ENOENT") {
          complete = false;
          issue(relative, error, "DIRECTORY");
        }
        return { files, issues, complete, scanned };
      }
      try {
        await walk(directory, relative);
      } finally {
        await directory.close();
      }
      return { files, issues, complete, scanned };
    } finally {
      release();
    }
  }

  close(): Promise<void> {
    this.stopping = true;
    this.closeResult ??= this.dispose();
    return this.closeResult;
  }

  private async dispose(): Promise<void> {
    await this.initialization?.catch(() => undefined);
    if (this.leases)
      await new Promise<void>((done) => {
        this.drained = done;
      });
    await this.directoryRoot?.close();
  }
}
