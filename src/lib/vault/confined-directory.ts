import { constants, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { FrameworkError } from "../errors.ts";
import { assertUtf8Text } from "./utf8.ts";

export const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | undefined)?.code;

export function pathComponents(relative: string, allowRoot = false): string[] {
  assertUtf8Text(relative);
  if (relative === "" && allowRoot) return [];
  const parts = relative.split("/");
  if (
    !relative ||
    path.isAbsolute(relative) ||
    /^[a-z]:/i.test(relative) ||
    parts.some((part) => !part || part === "." || part === ".." || /[\\\0]/.test(part))
  )
    throw new FrameworkError("PATH", "Vault paths must be nonempty, confined relative paths.");
  return parts;
}

export function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export class ConfinedDirectory {
  constructor(
    readonly absolute: string,
    readonly handle: fs.FileHandle,
    readonly descriptors: boolean,
  ) {}

  get anchor(): string {
    return this.descriptors ? `/proc/self/fd/${this.handle.fd}` : this.absolute;
  }

  child(name: string): string {
    if (pathComponents(name).length !== 1)
      throw new FrameworkError("PATH", "Expected one vault path component.");
    return path.join(this.anchor, name);
  }

  async verify(): Promise<void> {
    const actual = await fs.lstat(this.absolute);
    if (!actual.isDirectory() || !sameIdentity(actual, await this.handle.stat()))
      throw new FrameworkError("PATH", "Vault directory identity changed.");
  }

  async open(name: string, create = false): Promise<ConfinedDirectory> {
    const candidate = this.child(name);
    if (create) {
      try {
        await fs.mkdir(candidate);
        await this.sync();
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    const before = await fs.lstat(candidate);
    if (before.isSymbolicLink() || !before.isDirectory())
      throw new FrameworkError("PATH", "Vault directories must be real directories.");
    const handle = await fs.open(
      candidate,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat();
      if (!opened.isDirectory() || !sameIdentity(before, opened))
        throw new FrameworkError("PATH", "Vault directory changed while it was opened.");
      return new ConfinedDirectory(path.join(this.absolute, name), handle, this.descriptors);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async sync(): Promise<void> {
    try {
      await this.handle.sync();
    } catch (error) {
      // Some portable filesystems cannot fsync directories; Linux descriptor confinement requires it.
      if (
        this.descriptors ||
        !["EINVAL", "ENOTSUP", "EISDIR", "EBADF", "EPERM"].includes(errorCode(error) ?? "")
      )
        throw error;
    }
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}
