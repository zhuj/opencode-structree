import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, rename } from "node:fs/promises";
import path from "node:path";
import {
  claimRecoveryLayout,
  syncRecoveryDirectory,
  verifyRecoveryLayout,
} from "./layout-guard.ts";
import {
  parseReceipt,
  type ReceiptResult,
  type RecoveryLayout,
  type RecoveryReceipt,
} from "./receipt-types.ts";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
async function directory(parent: string, name: string, device: bigint): Promise<string> {
  const result = path.join(parent, name);
  try {
    await mkdir(result);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const stat = await lstat(result, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== device)
    throw new Error("unsafe");
  return result;
}

async function boundedNames(directoryPath: string, maximum: number): Promise<string[] | undefined> {
  const stream = await opendir(directoryPath, { bufferSize: 16 });
  const names: string[] = [];
  try {
    while (true) {
      const entry = await stream.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > maximum) return undefined;
    }
    return names;
  } finally {
    await stream.close();
  }
}

async function validateArtifacts(
  directoryPath: string,
  kind: "candidate" | "backup" | "rollback",
): Promise<boolean> {
  const names = await boundedNames(directoryPath, 32);
  if (!names) return false;
  const pattern =
    kind === "candidate"
      ? /^[a-f0-9]{64}\.candidate\.sqlite$/
      : kind === "backup"
        ? /^[a-f0-9]{64}\.old\.sqlite$/
        : /^[a-f0-9]{64}\.rollback\.sqlite$/;
  for (const name of names) {
    if (!pattern.test(name)) return false;
    const file = path.join(directoryPath, name);
    const stat = await lstat(file, { bigint: true });
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1n ||
      stat.size > 64n * 1024n * 1024n
    )
      return false;
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try {
        await lstat(`${file}${suffix}`);
        return false;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  }
  return true;
}

export async function openRecoveryLayout(
  cacheRoot: string,
  targetKey: string,
  maxEntries: number,
): Promise<ReceiptResult> {
  try {
    const rootStat = await lstat(cacheRoot, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      return { status: "blocked", code: "UNSAFE_WORK_AREA" };
    const base = await claimRecoveryLayout(cacheRoot);
    const targetNames = await boundedNames(base, maxEntries + 1);
    if (!targetNames) return { status: "blocked", code: "RECEIPT_LIMIT" };
    for (const name of targetNames) {
      if (name === "owner") continue;
      if (!/^[a-f0-9]{64}$/.test(name)) return { status: "blocked", code: "UNSAFE_WORK_AREA" };
      const stat = await lstat(path.join(base, name), { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== rootStat.dev)
        return { status: "blocked", code: "UNSAFE_WORK_AREA" };
    }
    const target = await directory(base, targetKey, rootStat.dev);
    const targetContents = await boundedNames(target, 4);
    if (
      !targetContents ||
      targetContents.some(
        (name) => !["receipts", "candidates", "backups", "rollback"].includes(name),
      )
    )
      return { status: "blocked", code: "UNSAFE_WORK_AREA" };
    const receipts = await directory(target, "receipts", rootStat.dev);
    const candidates = await directory(target, "candidates", rootStat.dev);
    const backups = await directory(target, "backups", rootStat.dev);
    const rollback = await directory(target, "rollback", rootStat.dev);
    await syncRecoveryDirectory(base);
    await syncRecoveryDirectory(target);
    if (
      !(await validateArtifacts(candidates, "candidate")) ||
      !(await validateArtifacts(backups, "backup")) ||
      !(await validateArtifacts(rollback, "rollback"))
    )
      return { status: "blocked", code: "UNSAFE_WORK_AREA" };
    const names = await boundedNames(receipts, maxEntries);
    if (!names) return { status: "blocked", code: "RECEIPT_LIMIT" };
    const parsed: RecoveryReceipt[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) return { status: "blocked", code: "RECEIPT_INVALID" };
      const file = path.join(receipts, name);
      const stat = await lstat(file, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > 8192n)
        return { status: "blocked", code: "RECEIPT_INVALID" };
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let bytes: Buffer;
      try {
        const buffer = Buffer.alloc(8193);
        let byteLength = 0;
        while (byteLength < buffer.byteLength) {
          const read = await handle.read(
            buffer,
            byteLength,
            buffer.byteLength - byteLength,
            byteLength,
          );
          if (read.bytesRead === 0) break;
          byteLength += read.bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        if (
          byteLength !== Number(stat.size) ||
          after.dev !== stat.dev ||
          after.ino !== stat.ino ||
          after.size !== stat.size ||
          after.mtimeNs !== stat.mtimeNs ||
          after.ctimeNs !== stat.ctimeNs
        )
          return { status: "blocked", code: "RECEIPT_INVALID" };
        bytes = buffer.subarray(0, byteLength);
      } finally {
        await handle.close();
      }
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        return { status: "blocked", code: "RECEIPT_INVALID" };
      }
      const receipt = parseReceipt(value);
      if (!receipt || receipt.actionId !== name.slice(0, 64) || receipt.targetKey !== targetKey)
        return { status: "blocked", code: "RECEIPT_INVALID" };
      parsed.push(receipt);
    }
    return {
      status: "ready",
      layout: { root: base, target, receipts, candidates, backups, rollback, device: rootStat.dev },
      receipts: parsed,
    };
  } catch (error) {
    return { status: "blocked", code: isMissing(error) ? "UNSAFE_WORK_AREA" : "RECEIPT_IO" };
  }
}

export async function persistReceipt(
  layout: RecoveryLayout,
  receipt: RecoveryReceipt,
): Promise<boolean> {
  const filename = `${receipt.actionId}.json`;
  const destination = path.join(layout.receipts, filename);
  const temporary = path.join(layout.receipts, `.${receipt.actionId}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!(await verifyRecoveryLayout(layout))) return false;
    try {
      const existing = await lstat(destination, { bigint: true });
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        existing.nlink !== 1n ||
        existing.size > 8192n
      )
        return false;
    } catch (error) {
      if (!isMissing(error)) return false;
    }
    handle = await open(temporary, "wx");
    await handle.writeFile(JSON.stringify(receipt));
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!(await verifyRecoveryLayout(layout))) return false;
    await rename(temporary, destination);
    const dir = await open(layout.receipts, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    return true;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}
