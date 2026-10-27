import type { RecoveryFailure, RecoveryRoot } from "../recovery/index.ts";
import type { ObjectDefinition } from "../types.ts";
import type { CacheSourceLimits } from "./source-types.ts";

const PAGE_BYTES = 64 * 1024;
const HARD_LIMITS = {
  files: 1000,
  directories: 100,
  entries: 10_000,
  bytes: 32 * 1024 * 1024,
  fileBytes: 5_000_000,
  depth: 32,
} as const;
export type Limits = { readonly [Key in keyof typeof HARD_LIMITS]: number };
const LIMIT_KEYS = ["files", "directories", "entries", "bytes", "fileBytes", "depth"] as const;
export type Frame = { readonly path: string; readonly depth: number };
export type SourceFile = { readonly path: string; readonly type: string };

export class Blocked extends Error {
  constructor(
    readonly code: string,
    readonly location?: string,
  ) {
    super(code);
  }
}

export function checkedLimits(limits: CacheSourceLimits = {}): Limits {
  const result = { ...HARD_LIMITS, ...limits };
  for (const name of LIMIT_KEYS) {
    const value = result[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_LIMITS[name])
      throw new TypeError(`Invalid cache source limit: ${name}`);
  }
  return result;
}

function failed(result: RecoveryFailure, location: string): never {
  const code = result.issues[0]?.code;
  throw new Blocked(code === "CANCELLED" ? "CANCELLED" : "SOURCE_IO", location);
}

export function sourceType(
  relative: string,
  definitions: readonly ObjectDefinition[],
): string | undefined {
  return definitions
    .filter(({ directory }) => relative.startsWith(`${directory}/`))
    .sort((left, right) => right.directory.length - left.directory.length)[0]?.name;
}

export async function listAll(
  root: RecoveryRoot,
  directory: Frame,
  limits: Limits,
  remainingEntries: number,
  signal?: AbortSignal,
) {
  if (directory.depth > limits.depth) throw new Blocked("DEPTH_LIMIT", directory.path || ".");
  const found = [];
  let offset = 0;
  let revision: string | undefined;
  let complete = false;
  while (!complete) {
    signal?.throwIfAborted();
    const page = await root.listDirectory({
      path: directory.path,
      offset,
      limit: Math.max(1, Math.min(256, remainingEntries - found.length + 1)),
      ...(revision === undefined ? {} : { expectedRevision: revision }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (page.status === "failed") failed(page, directory.path);
    if (page.issues.some((issue) => issue.code === "FILENAME_ENCODING"))
      throw new Blocked("UNSUPPORTED_FILENAME", directory.path || ".");
    if (page.status !== "ok" || page.provenance.consistency !== "stat-stable")
      throw new Blocked("DIRECTORY_CHANGED", directory.path || ".");
    if (revision !== undefined && page.provenance.expected !== "matched")
      throw new Blocked("DIRECTORY_CHANGED", directory.path || ".");
    if (found.length + page.entries.length > remainingEntries)
      throw new Blocked("ENTRY_LIMIT", directory.path || ".");
    revision = page.provenance.before.token;
    found.push(...page.entries);
    offset = page.nextOffset;
    complete = page.continuation === null;
  }
  return found;
}

export async function readSource(
  root: RecoveryRoot,
  file: SourceFile,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const chunks: Buffer[] = [];
  let length = 0;
  let revision: string | undefined;
  while (true) {
    signal?.throwIfAborted();
    const remaining = maxBytes - length;
    const page = await root.readRange({
      path: file.path,
      offset: length,
      limit: Math.min(PAGE_BYTES, remaining === 0 ? 1 : remaining),
      ...(revision === undefined ? {} : { expectedRevision: revision }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (page.status === "failed") failed(page, file.path);
    if (page.status !== "ok" || page.provenance.consistency !== "stat-stable")
      throw new Blocked("FILE_CHANGED", file.path);
    if (revision !== undefined && page.provenance.expected !== "matched")
      throw new Blocked("FILE_CHANGED", file.path);
    revision = page.provenance.before.token;
    const bytes = Buffer.from(page.bytesBase64, "base64");
    if (length + bytes.length > maxBytes) throw new Blocked("FILE_BYTES_LIMIT", file.path);
    if (length === maxBytes && bytes.length > 0) throw new Blocked("FILE_BYTES_LIMIT", file.path);
    if (bytes.length) chunks.push(bytes);
    length += bytes.length;
    if (page.eof === "observed-end") break;
    if (length === maxBytes) continue;
    if (bytes.length === 0) throw new Blocked("SHORT_READ", file.path);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks, length),
    );
  } catch {
    throw new Blocked("INVALID_UTF8", file.path);
  }
}
