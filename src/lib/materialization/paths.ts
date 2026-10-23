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
