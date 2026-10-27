import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { RecoveryLayout } from "./receipt-types.ts";

const OWNER = Buffer.from("object-mcp offline-cache-recovery layout v1\n");
function exists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
export async function syncRecoveryDirectory(directory: string): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function claimRecoveryLayout(cacheRoot: string): Promise<string> {
  const root = path.join(cacheRoot, ".object-mcp-cache-recovery");
  let created = false;
  try {
    await mkdir(root);
    created = true;
  } catch (error) {
    if (!exists(error)) throw error;
  }
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error("UNSAFE_WORK_AREA");
  const marker = path.join(root, "owner");
  if (created) {
    const handle = await open(marker, "wx");
    try {
      await handle.writeFile(OWNER);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncRecoveryDirectory(root);
    await syncRecoveryDirectory(cacheRoot);
  } else {
    const before = await lstat(marker, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size !== BigInt(OWNER.length)
    )
      throw new Error("UNSAFE_WORK_AREA");
    const handle = await open(
      marker,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const buffer = Buffer.alloc(OWNER.length + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat({ bigint: true });
      if (
        bytesRead !== OWNER.length ||
        !buffer.subarray(0, bytesRead).equals(OWNER) ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.ctimeNs !== after.ctimeNs
      )
        throw new Error("UNSAFE_WORK_AREA");
    } finally {
      await handle.close();
    }
  }
  return root;
}

export async function verifyRecoveryLayout(layout: RecoveryLayout): Promise<boolean> {
  try {
    for (const directory of [
      layout.root,
      layout.target,
      layout.receipts,
      layout.candidates,
      layout.backups,
      layout.rollback,
    ]) {
      const stat = await lstat(directory, { bigint: true });
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.dev !== layout.device ||
        (await realpath(directory)) !== directory
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
