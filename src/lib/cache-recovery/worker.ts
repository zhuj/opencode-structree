import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { documentLabels } from "../read-document.ts";
import { SqliteIndex } from "../sqlite/index.ts";
import type { ObjectDefinition } from "../types.ts";
import { checkpointCandidate } from "./checkpoint-worker.ts";
import { inspectClosedCache } from "./inspect.ts";
import type { RecoveryWorkerReply, RecoveryWorkerRequest } from "./protocol.ts";
import { collectCacheSources } from "./sources.ts";
import { verifyCandidateProjection } from "./verify-worker.ts";

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function candidateFootprint(file: string, maximum: number): Promise<bigint | undefined> {
  let bytes = 0n;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      const stat = await lstat(`${file}${suffix}`, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) return undefined;
      bytes += stat.size;
      if (bytes > BigInt(maximum)) return undefined;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return bytes;
}

const blocked = (
  operation: RecoveryWorkerRequest["operation"],
  code:
    | "BAD_REQUEST"
    | "SOURCE_INCOMPLETE"
    | "SOURCE_CHANGED"
    | "CACHE_BLOCKED"
    | "CANDIDATE_FAILED"
    | "CANDIDATE_SIZE"
    | "CANDIDATE_METADATA"
    | "CANDIDATE_INTEGRITY"
    | "CANDIDATE_CREATE_FAILED"
    | "CANDIDATE_INDEX_FAILED"
    | "CANDIDATE_CHECKPOINT_FAILED"
    | "CANDIDATE_INSPECT_FAILED"
    | "CANCELLED",
): RecoveryWorkerReply => ({ version: 1, operation, status: "blocked", code });

export async function runCacheRecoveryWorker(
  request: RecoveryWorkerRequest,
  signal: AbortSignal,
  options?: { readonly definitions: readonly ObjectDefinition[] },
): Promise<RecoveryWorkerReply> {
  if (signal.aborted) return blocked(request.operation, "CANCELLED");
  if (request.operation === "verify") {
    if (!options?.definitions.length) return blocked("verify", "SOURCE_INCOMPLETE");
    return verifyCandidateProjection(request, signal, options);
  }
  if (request.operation === "inspect") {
    try {
      if ((await realpath(request.root)) !== request.root) return blocked("inspect", "BAD_REQUEST");
      const result = await inspectClosedCache({
        authorizedDirectory: request.root,
        relativeFilename: request.relativeFilename,
        maxBytes: request.maxBytes,
        signal,
      });
      return result.status === "blocked"
        ? blocked("inspect", "CACHE_BLOCKED")
        : {
            version: 1,
            operation: "inspect",
            status: "ok",
            checksum: result.checksum,
            byteLength: result.byteLength,
            device: result.device,
            inode: result.inode,
            objectCount: result.objectCount,
            embeddingCount: result.embeddingCount,
          };
    } catch {
      return blocked("inspect", "CACHE_BLOCKED");
    }
  }

  if (request.operation === "checkpoint") return checkpointCandidate(request, signal);
  if (!options?.definitions.length) return blocked(request.operation, "SOURCE_INCOMPLETE");

  const sources = async () =>
    collectCacheSources({
      root: request.sourceRoot,
      definitions: options.definitions,
      signal,
      timeoutMs: 30_000,
    });
  if (request.operation === "collect") {
    const result = await sources();
    if (result.status === "blocked")
      return blocked(
        "collect",
        result.issues.some((issue) => issue.code === "CANCELLED")
          ? "CANCELLED"
          : "SOURCE_INCOMPLETE",
      );
    return {
      version: 1,
      operation: "collect",
      status: "ok",
      fingerprint: result.fingerprint,
      files: result.files,
      bytes: result.bytes,
    };
  }

  let candidatePath: string;
  try {
    if (
      (await realpath(request.sourceRoot)) !== request.sourceRoot ||
      (await realpath(request.workDirectory)) !== request.workDirectory ||
      path.basename(request.candidateFilename) !== request.candidateFilename ||
      !/^[a-f0-9]{64}\.candidate\.sqlite$/.test(request.candidateFilename)
    )
      return blocked("build", "BAD_REQUEST");
    candidatePath = path.join(request.workDirectory, request.candidateFilename);
  } catch {
    return blocked("build", "BAD_REQUEST");
  }
  const collected = await sources();
  if (collected.status === "blocked")
    return blocked(
      "build",
      collected.issues.some((issue) => issue.code === "CANCELLED")
        ? "CANCELLED"
        : "SOURCE_INCOMPLETE",
    );
  if (collected.fingerprint !== request.expectedFingerprint)
    return blocked("build", "SOURCE_CHANGED");
  if (signal.aborted) return blocked("build", "CANCELLED");

  let exclusive: Awaited<ReturnType<typeof open>> | undefined;
  let index: SqliteIndex | undefined;
  let stage: "CREATE" | "INDEX" = "CREATE";
  try {
    exclusive = await open(candidatePath, "wx");
    await exclusive.close();
    exclusive = undefined;
    stage = "INDEX";
    index = new SqliteIndex(
      { ...request.sqlite, path: candidatePath, busyTimeoutMs: 0 },
      request.search,
    );
    if ((await candidateFootprint(candidatePath, request.candidateMaxBytes)) === undefined)
      return blocked("build", "CANDIDATE_SIZE");
    for (const document of collected.documents) {
      if (signal.aborted) return blocked("build", "CANCELLED");
      const existing = await lstat(candidatePath, { bigint: true });
      const footprint = await candidateFootprint(candidatePath, request.candidateMaxBytes);
      const projected =
        (footprint ?? BigInt(request.candidateMaxBytes) + 1n) +
        BigInt(Buffer.byteLength(document.raw, "utf8")) * 48n +
        1_048_576n;
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        existing.nlink !== 1n ||
        footprint === undefined ||
        projected > BigInt(request.candidateMaxBytes) ||
        (await candidateFootprint(candidatePath, request.candidateMaxBytes)) === undefined
      )
        return blocked("build", "CANDIDATE_SIZE");
      index.upsertDocument(document);
      const metadata = index.getMetadata(document.key);
      const labels = documentLabels(document);
      const json = JSON.stringify(
        document.partial ? { ...document.json, id: document.object.id } : document.json,
      );
      if (
        !metadata ||
        metadata.type !== document.type ||
        metadata.id !== labels.id ||
        metadata.name !== labels.name ||
        metadata.title !== labels.title ||
        metadata.path !== document.path ||
        metadata.checksum !== document.checksum ||
        metadata.raw !== document.raw ||
        metadata.body !== document.body ||
        JSON.stringify(metadata.json) !== json
      )
        return blocked("build", "CANDIDATE_METADATA");
      if ((await candidateFootprint(candidatePath, request.candidateMaxBytes)) === undefined)
        return blocked("build", "CANDIDATE_SIZE");
    }
    index.close();
    index = undefined;
    return {
      version: 1,
      operation: "build",
      status: "ok",
      fingerprint: collected.fingerprint,
      files: collected.files,
      bytes: collected.bytes,
      objectCount: collected.files,
      embeddingCount: 0,
    };
  } catch {
    if (signal.aborted) return blocked("build", "CANCELLED");
    return blocked(
      "build",
      stage === "CREATE" ? "CANDIDATE_CREATE_FAILED" : "CANDIDATE_INDEX_FAILED",
    );
  } finally {
    try {
      index?.close();
    } catch {
      // The failure outcome remains fixed; no native error details leave the child.
    }
    if (exclusive) {
      try {
        await exclusive.close();
      } catch {
        // Candidate creation cannot be reported as successful after close failure.
      }
    }
  }
}
