import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { DoctorFinding, ProbeExecution } from "./types.ts";

const finding = (code: string, message: string): DoctorFinding => ({
  capability: "cache",
  code,
  severity: "warning",
  message,
  actions: ["inspect-cache"],
});
const blocked = (code: string, message: string): ProbeExecution => ({
  status: "blocked",
  coverage: "unknown",
  findings: [
    {
      ...finding(code, message),
      actions: ["retry-diagnosis"],
    },
  ],
});

async function confinedFile(root: string, selected: string): Promise<string | null> {
  const base = await fs.realpath(root);
  const target = await fs.realpath(selected);
  const relative = path.relative(base, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return null;
  return (await fs.lstat(target)).isFile() ? target : null;
}

export async function runCacheCheck(
  options: { readonly projectRoot: string; readonly cacheFile?: string },
  signal?: AbortSignal,
): Promise<ProbeExecution> {
  if (!options.cacheFile)
    return blocked("CACHE_NOT_SELECTED", "The selected cache file is unavailable for inspection.");
  try {
    signal?.throwIfAborted();
    const file = await confinedFile(options.projectRoot, options.cacheFile);
    if (!file)
      return blocked("CACHE_UNSAFE", "The selected cache file could not be safely inspected.");
    const handle = await fs.open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    let header: Uint8Array;
    try {
      if (!(await handle.stat()).isFile())
        return blocked("CACHE_UNSAFE", "The selected cache file could not be safely inspected.");
      header = new Uint8Array(16);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      header = header.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    signal?.throwIfAborted();
    const sqlite = new TextDecoder().decode(header) === "SQLite format 3\0";
    const detail = sqlite
      ? "Cache format was observed; integrity and freshness were not checked."
      : "The selected cache has an unrecognized file header.";
    return {
      status: "findings",
      coverage: "limited",
      context: { files: 1 },
      findings: [finding(sqlite ? "CACHE_SEMANTICS_UNCHECKED" : "CACHE_HEADER_UNKNOWN", detail)],
    };
  } catch (error) {
    if (signal?.aborted)
      return blocked("CACHE_ABORTED", "The selected cache file could not be safely inspected.");
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return {
        status: "findings",
        coverage: "limited",
        findings: [
          finding("CACHE_MISSING", "The selected cache file is unavailable for inspection."),
        ],
      };
    return blocked("CACHE_UNAVAILABLE", "The selected cache file could not be safely inspected.");
  }
}
