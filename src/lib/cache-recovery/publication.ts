import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import path from "node:path";
import { copyRetainedBytes } from "./retained-copy.ts";

export interface CacheRevision {
  readonly checksum: string;
  readonly device: string;
  readonly inode: string;
}
export type PublicationCode =
  | "UNSAFE_TARGET"
  | "SIDECAR_PRESENT"
  | "SIZE_LIMIT"
  | "IO_BLOCKED"
  | "REVISION_CHANGED";
export type PublicationResult =
  | { readonly status: "ok"; readonly revision: CacheRevision }
  | { readonly status: "postcheck-failed"; readonly revision: CacheRevision }
  | { readonly status: "blocked"; readonly code: PublicationCode };

type Identity = {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
};
const identity = (stat: BigIntStats): Identity => ({
  dev: stat.dev,
  ino: stat.ino,
  size: stat.size,
  mtimeNs: stat.mtimeNs,
  ctimeNs: stat.ctimeNs,
});
const same = (left: Identity, right: Identity): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;
async function noSidecars(file: string): Promise<boolean> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await lstat(`${file}${suffix}`);
      return false;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return true;
}
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function fingerprint(
  file: string,
  maxBytes: number,
  sync: boolean,
): Promise<{ revision: CacheRevision; identity: Identity } | PublicationCode> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!(await noSidecars(file))) return "SIDECAR_PRESENT";
    const pathBefore = await lstat(file, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n)
      return "UNSAFE_TARGET";
    if (pathBefore.size > BigInt(maxBytes)) return "SIZE_LIMIT";
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = identity(await handle.stat({ bigint: true }));
    if (!same(identity(pathBefore), before)) return "UNSAFE_TARGET";
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > maxBytes) return "SIZE_LIMIT";
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (sync) await handle.sync();
    const after = identity(await handle.stat({ bigint: true }));
    const pathAfter = identity(await lstat(file, { bigint: true }));
    if (!same(before, after) || !same(after, pathAfter) || BigInt(bytes) !== before.size)
      return "REVISION_CHANGED";
    if (!(await noSidecars(file))) return "SIDECAR_PRESENT";
    return {
      revision: {
        checksum: hash.digest("hex"),
        device: before.dev.toString(),
        inode: before.ino.toString(),
      },
      identity: before,
    };
  } catch (error) {
    return isMissing(error) ? "UNSAFE_TARGET" : "IO_BLOCKED";
  } finally {
    if (handle) await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function verifyCacheRevision(
  file: string,
  expected: CacheRevision,
  maxBytes: number,
): Promise<PublicationResult> {
  const found = await fingerprint(file, maxBytes, false);
  if (typeof found === "string") return { status: "blocked", code: found };
  return found.revision.checksum === expected.checksum &&
    found.revision.device === expected.device &&
    found.revision.inode === expected.inode
    ? { status: "ok", revision: found.revision }
    : { status: "blocked", code: "REVISION_CHANGED" };
}

export async function retainVerifiedBackup(
  target: string,
  backup: string,
  expected: CacheRevision,
  maxBytes: number,
): Promise<PublicationResult> {
  const current = await verifyCacheRevision(target, expected, maxBytes);
  if (current.status !== "ok") return current;
  try {
    await copyRetainedBytes(target, backup, maxBytes);
    const saved = await fingerprint(backup, maxBytes, true);
    if (typeof saved === "string") return { status: "blocked", code: saved };
    if (saved.revision.checksum !== expected.checksum)
      return { status: "blocked", code: "REVISION_CHANGED" };
    await syncDirectory(path.dirname(backup));
    return { status: "ok", revision: saved.revision };
  } catch {
    return { status: "blocked", code: "IO_BLOCKED" };
  }
}

export async function publishCandidate(
  candidate: string,
  target: string,
  expected: CacheRevision,
  candidateChecksum: string,
  maxBytes: number,
): Promise<PublicationResult> {
  const current = await verifyCacheRevision(target, expected, maxBytes);
  if (current.status !== "ok") return current;
  const candidateState = await fingerprint(candidate, maxBytes, true);
  if (typeof candidateState === "string") return { status: "blocked", code: candidateState };
  if (
    candidateState.revision.checksum !== candidateChecksum ||
    candidateState.identity.dev.toString() !== expected.device
  )
    return { status: "blocked", code: "REVISION_CHANGED" };
  const finalTarget = await verifyCacheRevision(target, expected, maxBytes);
  if (finalTarget.status !== "ok") return finalTarget;
  let replaced = false;
  try {
    await rename(candidate, target);
    replaced = true;
    await syncDirectory(path.dirname(target));
    if (path.dirname(candidate) !== path.dirname(target))
      await syncDirectory(path.dirname(candidate));
    const published = await fingerprint(target, maxBytes, false);
    return typeof published !== "string" &&
      published.revision.checksum === candidateChecksum &&
      published.revision.device === candidateState.revision.device &&
      published.revision.inode === candidateState.revision.inode
      ? { status: "ok", revision: published.revision }
      : { status: "postcheck-failed", revision: candidateState.revision };
  } catch {
    return replaced
      ? { status: "postcheck-failed", revision: candidateState.revision }
      : { status: "blocked", code: "IO_BLOCKED" };
  }
}

export async function rollbackVerifiedBackup(
  backup: string,
  target: string,
  published: CacheRevision,
  oldChecksum: string,
  rollbackCandidate: string,
  maxBytes: number,
): Promise<PublicationResult> {
  const current = await verifyCacheRevision(target, published, maxBytes);
  if (current.status !== "ok") return current;
  try {
    await copyRetainedBytes(backup, rollbackCandidate, maxBytes);
    const restored = await fingerprint(rollbackCandidate, maxBytes, true);
    if (typeof restored === "string") return { status: "blocked", code: restored };
    if (
      restored.revision.checksum !== oldChecksum ||
      restored.identity.dev.toString() !== published.device
    )
      return { status: "blocked", code: "REVISION_CHANGED" };
    const recheck = await verifyCacheRevision(target, published, maxBytes);
    if (recheck.status !== "ok") return recheck;
    await rename(rollbackCandidate, target);
    await syncDirectory(path.dirname(target));
    if (path.dirname(rollbackCandidate) !== path.dirname(target))
      await syncDirectory(path.dirname(rollbackCandidate));
    const after = await fingerprint(target, maxBytes, false);
    if (typeof after === "string") return { status: "blocked", code: after };
    return after.revision.checksum === oldChecksum
      ? { status: "ok", revision: after.revision }
      : { status: "blocked", code: "REVISION_CHANGED" };
  } catch {
    return { status: "blocked", code: "IO_BLOCKED" };
  }
}
