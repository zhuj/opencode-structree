import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { checkSignal, reject, sameIdentity, utf8Path } from "./safety.ts";

/** Descriptor mode anchors traversal to owned handles. Portable mode detects
 * identity changes but cannot eliminate hostile concurrent ancestor replacement. */
export class RecoveryDirectory {
  constructor(
    readonly absolute: string,
    readonly handle: fs.FileHandle,
    readonly confinement: "descriptor" | "portable-checked",
  ) {}
  get anchor(): string {
    return this.confinement === "descriptor" ? `/proc/self/fd/${this.handle.fd}` : this.absolute;
  }
  async verify(): Promise<void> {
    if (this.confinement === "descriptor") return;
    const actual = await fs.lstat(this.absolute, { bigint: true });
    if (!actual.isDirectory() || !sameIdentity(actual, await this.handle.stat({ bigint: true })))
      reject("PATH_CHANGED", "Directory identity changed during recovery.");
  }
  async open(parts: readonly string[], signal?: AbortSignal): Promise<RecoveryDirectory> {
    checkSignal(signal);
    await this.verify();
    const handle = await fs.open(this.anchor, constants.O_RDONLY | constants.O_DIRECTORY);
    let current = new RecoveryDirectory(this.absolute, handle, this.confinement);
    try {
      if (
        !sameIdentity(await handle.stat({ bigint: true }), await this.handle.stat({ bigint: true }))
      )
        reject("PATH_CHANGED", "Directory identity changed during recovery.");
      for (const part of parts) {
        checkSignal(signal);
        await current.verify();
        const candidate = path.join(current.anchor, part);
        const before = await fs.lstat(candidate, { bigint: true });
        if (!before.isDirectory() || before.isSymbolicLink())
          reject("UNSAFE_PATH", "Descendant directories must not be symlinks or special files.");
        const child = await fs.open(
          candidate,
          constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const after = await child.stat({ bigint: true });
          if (!after.isDirectory() || !sameIdentity(before, after))
            reject("PATH_CHANGED", "Directory identity changed while opening it.");
        } catch (error) {
          await child.close();
          throw error;
        }
        const previous = current;
        current = new RecoveryDirectory(path.join(current.absolute, part), child, this.confinement);
        await previous.handle.close();
      }
      await current.verify();
      checkSignal(signal);
      return current;
    } catch (error) {
      await current.handle.close();
      throw error;
    }
  }
}

export async function openDirectory(
  root: string,
  mode: "auto" | "descriptor" | "portable",
): Promise<RecoveryDirectory> {
  utf8Path(root);
  const absolute = await fs.realpath(root);
  let descriptor = false;
  if (mode !== "portable" && process.platform === "linux" && constants.O_NOFOLLOW) {
    try {
      descriptor = (await fs.statfs("/proc/self/fd")).type === 0x9fa0;
    } catch {
      descriptor = false;
    }
  }
  if (mode === "descriptor" && !descriptor)
    reject("UNSUPPORTED", "Descriptor confinement requires Linux procfs.");
  const before = await fs.lstat(absolute, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink())
    reject("ROOT_TYPE", "The existing selected root must be a directory.");
  const handle = await fs.open(
    absolute,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const after = await handle.stat({ bigint: true });
    if (!after.isDirectory() || !sameIdentity(before, after))
      reject("PATH_CHANGED", "Root identity changed while opening it.");
    return new RecoveryDirectory(absolute, handle, descriptor ? "descriptor" : "portable-checked");
  } catch (error) {
    await handle.close();
    throw error;
  }
}
