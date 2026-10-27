import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";

export function portablePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !path.posix.isAbsolute(value) &&
    !/^[A-Za-z]:/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}
export const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

/** Reject symlinks at every component, including dangling links and missing-leaf ancestors. */
export async function confinedPath(
  root: string,
  relative: string,
  allowMissing = false,
): Promise<string> {
  if (!portablePath(relative)) throw new Error("Path must be a portable, confined relative path.");
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new Error("Symbolic links are not accepted in confined paths.");
    } catch (cause) {
      if (!(allowMissing && missing(cause))) throw cause;
    }
  }
  return current;
}
export const missing = (cause: unknown): boolean =>
  cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT";

export class InspectionBudgetExceeded extends Error {
  constructor() {
    super("Output inspection budget exceeded.");
  }
}

export interface InspectionBudget {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly signal?: AbortSignal;
  totalBytes: number;
}

export interface InspectionReadHandle {
  stat(): Promise<{ isFile(): boolean; size: number }>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
}

export async function readInspectionHandle(
  handle: InspectionReadHandle,
  budget: InspectionBudget,
): Promise<string> {
  const initial = await handle.stat();
  const allowed = Math.min(budget.maxFileBytes, budget.maxTotalBytes - budget.totalBytes);
  if (!initial.isFile() || initial.size > allowed) throw new InspectionBudgetExceeded();
  const parts: Uint8Array[] = [];
  let bytesRead = 0;
  while (true) {
    budget.signal?.throwIfAborted();
    const current = await handle.stat();
    if (!current.isFile() || current.size > allowed) throw new InspectionBudgetExceeded();
    if (bytesRead === allowed) break;
    const buffer = new Uint8Array(Math.min(65_536, allowed - bytesRead));
    const read = await handle.read(buffer, 0, buffer.length, bytesRead);
    if (read.bytesRead === 0) break;
    parts.push(buffer.subarray(0, read.bytesRead));
    bytesRead += read.bytesRead;
    budget.totalBytes += read.bytesRead;
  }
  budget.signal?.throwIfAborted();
  const final = await handle.stat();
  if (!final.isFile() || final.size > allowed || final.size !== bytesRead)
    throw new InspectionBudgetExceeded();
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(parts));
}

export async function readInspectionFile(file: string, budget: InspectionBudget): Promise<string> {
  const handle = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    return await readInspectionHandle(handle, budget);
  } finally {
    await handle.close();
  }
}

export async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
}

export async function readSource(
  root: string,
  relative: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const file = await confinedPath(root, relative);
  const handle = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 5_000_000)
      throw new Error("Source must be a regular file of at most 5000000 bytes.");
    const bytes = await handle.readFile({ signal });
    if (bytes.length > 5_000_000) throw new Error("Source exceeds maximum size.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}
