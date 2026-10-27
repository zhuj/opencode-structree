import { openDirectory, type RecoveryDirectory } from "./directory.ts";
import { listDirectory } from "./list.ts";
import { readFile } from "./read.ts";
import { failure, reject } from "./safety.ts";
import type {
  ListOptions,
  ListResult,
  ReadRangeOptions,
  ReadResult,
  RecoveryFailure,
} from "./types.ts";

export * from "./types.ts";

/** Owns the root handle. close() rejects new work, drains active calls, and is
 * idempotent. Cancellation is cooperative between filesystem calls, not a syscall deadline. */
export class RecoveryRoot {
  private closing: Promise<void> | undefined;
  private active = 0;
  private drained: (() => void) | undefined;
  constructor(private readonly directory: RecoveryDirectory) {}
  get confinement(): "descriptor" | "portable-checked" {
    return this.directory.confinement;
  }
  async readRange(options: ReadRangeOptions): Promise<ReadResult> {
    try {
      if (this.closing) reject("CLOSED", "The recovery root is closed.");
      this.active++;
      try {
        return { ...(await readFile(this.directory, options)), confinement: this.confinement };
      } finally {
        this.active--;
        if (this.active === 0) this.drained?.();
      }
    } catch (error) {
      return failure(error);
    }
  }
  async listDirectory(options: ListOptions = {}): Promise<ListResult> {
    try {
      if (this.closing) reject("CLOSED", "The recovery root is closed.");
      this.active++;
      try {
        return { ...(await listDirectory(this.directory, options)), confinement: this.confinement };
      } finally {
        this.active--;
        if (this.active === 0) this.drained?.();
      }
    } catch (error) {
      return failure(error);
    }
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      if (this.active > 0)
        await new Promise<void>((resolve) => {
          this.drained = resolve;
        });
      await this.directory.handle.close();
    })();
    return this.closing;
  }
}
export type OpenRecoveryResult =
  | { readonly version: 1; readonly status: "opened"; readonly root: RecoveryRoot }
  | RecoveryFailure;
export async function openRecoveryRoot(
  root: string,
  options: {
    readonly confinement?: "auto" | "descriptor" | "portable";
  } = {},
): Promise<OpenRecoveryResult> {
  try {
    return {
      version: 1,
      status: "opened",
      root: new RecoveryRoot(await openDirectory(root, options.confinement ?? "auto")),
    };
  } catch (error) {
    return failure(error);
  }
}
