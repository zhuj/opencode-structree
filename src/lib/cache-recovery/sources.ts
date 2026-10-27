import { createHash } from "node:crypto";
import path from "node:path";
import { defaultConfig } from "../config.ts";
import { FileStore, objectKey } from "../filesystem.ts";
import type { OpenRecoveryResult, RecoveryRoot } from "../recovery/index.ts";
import { openRecoveryRoot } from "../recovery/index.ts";
import { ObjectRegistry } from "../registry.ts";
import type { ReadDocument } from "../types.ts";
import {
  Blocked,
  checkedLimits,
  type Frame,
  listAll,
  readSource,
  type SourceFile,
  sourceType,
} from "./source-reader.ts";
import type {
  CacheSourceManifestEntry,
  CacheSourceOptions,
  CacheSourceResult,
} from "./source-types.ts";

export type {
  CacheSourceLimits,
  CacheSourceManifestEntry,
  CacheSourceOptions,
  CacheSourceResult,
} from "./source-types.ts";

type RecoveryRootOpener = (root: string) => Promise<OpenRecoveryResult>;

function fingerprint(manifest: readonly CacheSourceManifestEntry[]): string {
  const canonical = JSON.stringify(
    manifest.map(({ type, id, path: sourcePath, checksum }) => [type, id, sourcePath, checksum]),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function manifest(document: ReadDocument): CacheSourceManifestEntry {
  return {
    type: document.type,
    id: document.object.id,
    path: document.path,
    checksum: document.checksum,
  };
}

export async function collectCacheSources(
  options: CacheSourceOptions,
  openRoot: RecoveryRootOpener = openRecoveryRoot,
): Promise<CacheSourceResult> {
  const rootPath = options.root;
  const callerSignal = options.signal;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const limitsInput = { ...options.limits };
  const definitions = Object.freeze(
    options.definitions.map((definition) =>
      Object.freeze({
        ...definition,
        ...(definition.relations === undefined
          ? {}
          : {
              relations: Object.freeze(
                definition.relations.map((relation) => Object.freeze({ ...relation })),
              ),
            }),
      }),
    ),
  );
  let recovery: RecoveryRoot | undefined;
  let result: CacheSourceResult;
  const deadlineController = new AbortController();
  let operationSignal: AbortSignal = deadlineController.signal;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
      throw new TypeError("Invalid cache source timeout.");
    const limits = checkedLimits(limitsInput);
    deadlineTimer = setTimeout(() => deadlineController.abort(), timeoutMs);
    operationSignal = callerSignal
      ? AbortSignal.any([callerSignal, deadlineController.signal])
      : deadlineController.signal;
    const signal = operationSignal;
    if (signal.aborted) throw new Blocked("CANCELLED");
    const opened = await openRoot(rootPath);
    if (opened.status === "failed") throw new Blocked("SOURCE_IO", ".");
    recovery = opened.root;
    const registry = new ObjectRegistry(definitions);
    const store = new FileStore(
      registry,
      {
        ...defaultConfig,
        root: rootPath,
        sync: { ...defaultConfig.sync, maxFileBytes: limits.fileBytes },
      },
      { access: "read-only" },
    );
    const stack: Frame[] = [{ path: "", depth: 0 }];
    const files: SourceFile[] = [];
    const identities = new Set<string>();
    let directories = 0;
    let entries = 0;
    let bytes = 0;
    while (stack.length) {
      signal.throwIfAborted();
      const directory = stack.pop();
      if (!directory) break;
      directories++;
      if (directories > limits.directories)
        throw new Blocked("DIRECTORY_LIMIT", directory.path || ".");
      const children = await listAll(recovery, directory, limits, limits.entries - entries, signal);
      entries += children.length;
      if (entries > limits.entries) throw new Blocked("ENTRY_LIMIT", directory.path || ".");
      for (const entry of children) {
        if (entry.nameEncoding === "unsupported")
          throw new Blocked("UNSUPPORTED_FILENAME", directory.path || ".");
        const relative = entry.path;
        if (entry.type === "symlink") throw new Blocked("SYMLINK", relative);
        if (entry.type === "other") throw new Blocked("NONREGULAR", relative);
        if (entry.type === "directory") {
          if (relative === ".object-mcp-recovery" || relative.startsWith(".object-mcp-recovery/"))
            throw new Blocked("HIDDEN_NAMESPACE", relative);
          stack.push({ path: relative, depth: directory.depth + 1 });
          continue;
        }
        if (!/\.md$/i.test(relative)) continue;
        const type = sourceType(relative, definitions);
        if (type === undefined) throw new Blocked("UNKNOWN_SOURCE_TYPE", relative);
        if (path.posix.basename(relative).startsWith("."))
          throw new Blocked("HIDDEN_SOURCE", relative);
        files.push({ path: relative, type });
        if (files.length > limits.files) throw new Blocked("FILE_LIMIT", relative);
      }
    }
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const documents: ReadDocument[] = [];
    const manifestEntries: CacheSourceManifestEntry[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      const readCap = Math.min(limits.fileBytes, limits.bytes - bytes);
      let raw: string;
      try {
        raw = await readSource(recovery, file, readCap, signal);
      } catch (error) {
        if (
          error instanceof Blocked &&
          error.code === "FILE_BYTES_LIMIT" &&
          readCap < limits.fileBytes
        )
          throw new Blocked("TOTAL_BYTES_LIMIT", file.path);
        throw error;
      }
      const document = store.parse(file.type, file.path, raw);
      const identity = objectKey(document.type, document.object.id);
      if (identities.has(identity)) throw new Blocked("DUPLICATE_IDENTITY", file.path);
      identities.add(identity);
      bytes += Buffer.byteLength(raw, "utf8");
      if (bytes > limits.bytes) throw new Blocked("TOTAL_BYTES_LIMIT", file.path);
      documents.push(document);
      manifestEntries.push(manifest(document));
    }
    signal.throwIfAborted();
    result = {
      status: "complete",
      documents,
      manifest: manifestEntries,
      fingerprint: fingerprint(manifestEntries),
      bytes,
      files: files.length,
      entries,
    };
  } catch (error) {
    result = {
      status: "blocked",
      issues: [
        error instanceof Blocked
          ? {
              code: error.code,
              ...(error.location === undefined ? {} : { location: error.location }),
            }
          : { code: operationSignal?.aborted ? "CANCELLED" : "SOURCE_IO" },
      ],
    };
  }
  try {
    await recovery?.close();
  } catch {
    return { status: "blocked", issues: [{ code: "SOURCE_CLOSE_FAILED" }] };
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
  return result;
}
