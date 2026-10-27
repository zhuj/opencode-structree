import { lstat } from "node:fs/promises";
import path from "node:path";
import type { ReceiptResult } from "./receipt-types.ts";
import { openRecoveryLayout } from "./receipts.ts";

/** Reject incomplete retained layouts before native target admission; never create a new layout. */
export async function preflightRecoveryReceipts(
  cacheRoot: string,
  targetKey: string,
  maxEntries: number,
): Promise<ReceiptResult | undefined> {
  const base = path.join(cacheRoot, ".object-mcp-cache-recovery");
  try {
    await lstat(base);
  } catch (error) {
    const missing =
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    return missing ? undefined : { status: "blocked", code: "RECEIPT_IO" };
  }
  const target = path.join(base, targetKey);
  try {
    for (const directoryPath of [
      base,
      target,
      ...["receipts", "candidates", "backups", "rollback"].map((name) => path.join(target, name)),
    ]) {
      const stat = await lstat(directoryPath);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        return { status: "blocked", code: "UNSAFE_WORK_AREA" };
    }
  } catch {
    return { status: "blocked", code: "RECEIPT_INVALID" };
  }
  return openRecoveryLayout(cacheRoot, targetKey, maxEntries);
}
