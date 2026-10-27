import { createHash } from "node:crypto";
import { type BigIntStats, constants as fsConstants } from "node:fs";
import { type FileHandle, lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { CacheInspectionCode, InspectClosedCacheOptions } from "./inspect.ts";

const HARD_MAX_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

type FileIdentity = {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
};
type PreparedFile = {
  readonly status: "ready";
  readonly file: string;
  readonly handle: FileHandle;
  readonly identity: FileIdentity;
  readonly checksum: string;
  readonly byteLength: number;
};
export type PreparedInspection =
  | PreparedFile
  | { readonly status: "blocked"; readonly code: CacheInspectionCode };

type FileClose = (handle: FileHandle) => Promise<void>;
let fileClose: FileClose = (handle) => handle.close();

export async function withPreparedFileCloseHookForTest<A>(
  close: FileClose,
  work: () => Promise<A>,
): Promise<A> {
  const previous = fileClose;
  fileClose = close;
  try {
    return await work();
  } finally {
    fileClose = previous;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

const identity = (stat: BigIntStats): FileIdentity => ({
  dev: stat.dev,
  ino: stat.ino,
  size: stat.size,
  mtimeNs: stat.mtimeNs,
  ctimeNs: stat.ctimeNs,
});
const sameIdentity = (a: FileIdentity, b: FileIdentity): boolean =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const blocked = (code: CacheInspectionCode): PreparedInspection => ({ status: "blocked", code });

function validRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !path.posix.isAbsolute(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

async function sidecarsAbsent(file: string): Promise<boolean> {
  for (const suffix of ["-wal", "-journal", "-shm"]) {
    try {
      await lstat(`${file}${suffix}`);
      return false;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return true;
}

export async function prepareClosedCacheFile(
  options: InspectClosedCacheOptions,
): Promise<PreparedInspection> {
  if (options.signal?.aborted) return blocked("ABORTED");
  const maximum = options.maxBytes ?? HARD_MAX_BYTES;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > HARD_MAX_BYTES ||
    typeof options.authorizedDirectory !== "string" ||
    typeof options.relativeFilename !== "string"
  )
    return blocked("INVALID_OPTIONS");
  const relative = options.relativeFilename;
  const base = path.basename(relative);
  if (
    !validRelativePath(relative) ||
    base === ".object-mcp-lock.sqlite" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/.test(base)
  )
    return blocked("UNSAFE_PATH");
  try {
    return await (async (): Promise<PreparedInspection> => {
      let handle: FileHandle | undefined;
      try {
        const root = path.resolve(options.authorizedDirectory);
        let canonicalRoot: string;
        try {
          canonicalRoot = await realpath(root);
        } catch {
          return blocked("UNSAFE_PATH");
        }
        if (canonicalRoot !== root) return blocked("UNSAFE_PATH");
        let parent = root;
        const parts = relative.split("/");
        for (const part of parts.slice(0, -1)) {
          parent = path.join(parent, part);
          const stat = await lstat(parent, { bigint: true });
          if (!stat.isDirectory() || stat.isSymbolicLink()) return blocked("UNSAFE_PATH");
        }
        const file = path.join(root, ...parts);
        if (!(await sidecarsAbsent(file))) return blocked("SIDECAR_PRESENT");
        const beforePath = await lstat(file, { bigint: true });
        if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.nlink !== 1n)
          return blocked("UNSAFE_TARGET");
        if (beforePath.size > BigInt(maximum)) return blocked("SIZE_LIMIT");
        handle = await open(
          file,
          fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
        );
        const before = identity(await handle.stat({ bigint: true }));
        if (!sameIdentity(identity(beforePath), before)) return blocked("UNSAFE_TARGET");
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(CHUNK_BYTES);
        const header = Buffer.alloc(100);
        let headerBytes = 0;
        let position = 0;
        while (true) {
          if (options.signal?.aborted) return blocked("ABORTED");
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
          if (bytesRead === 0) break;
          const headerLength = Math.min(header.byteLength - headerBytes, bytesRead);
          if (headerLength > 0) {
            buffer.copy(header, headerBytes, 0, headerLength);
            headerBytes += headerLength;
          }
          position += bytesRead;
          if (position > maximum) return blocked("SIZE_LIMIT");
          hash.update(buffer.subarray(0, bytesRead));
        }
        if (
          headerBytes < header.byteLength ||
          !header.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))
        )
          return blocked("INVALID_HEADER");
        if (header.readUInt32BE(68) !== 0x4f4d4350 || header.readUInt32BE(60) !== 3)
          return blocked("OWNERSHIP_MISMATCH");
        const after = identity(await handle.stat({ bigint: true }));
        const afterPath = identity(await lstat(file, { bigint: true }));
        if (
          !sameIdentity(before, after) ||
          !sameIdentity(after, afterPath) ||
          BigInt(position) !== before.size
        )
          return blocked("UNSAFE_TARGET");
        if (!(await sidecarsAbsent(file))) return blocked("SIDECAR_PRESENT");
        const retainedHandle = handle;
        handle = undefined;
        return {
          status: "ready",
          file,
          handle: retainedHandle,
          identity: before,
          checksum: hash.digest("hex"),
          byteLength: position,
        };
      } catch (error) {
        return blocked(errorCode(error) === "ENOENT" ? "TARGET_MISSING" : "IO_BLOCKED");
      } finally {
        if (handle) await fileClose(handle);
      }
    })();
  } catch (error) {
    return blocked(errorCode(error) === "ENOENT" ? "TARGET_MISSING" : "IO_BLOCKED");
  }
}

export async function verifyPreparedCacheFile(
  prepared: PreparedFile,
): Promise<CacheInspectionCode | undefined> {
  try {
    if (!(await sidecarsAbsent(prepared.file))) return "SIDECAR_PRESENT";
    const held = identity(await prepared.handle.stat({ bigint: true }));
    const pathIdentity = identity(await lstat(prepared.file, { bigint: true }));
    return sameIdentity(prepared.identity, held) && sameIdentity(held, pathIdentity)
      ? undefined
      : "UNSAFE_TARGET";
  } catch {
    return "IO_BLOCKED";
  }
}

export async function closePreparedCacheFile(prepared: PreparedFile): Promise<void> {
  await fileClose(prepared.handle);
}
