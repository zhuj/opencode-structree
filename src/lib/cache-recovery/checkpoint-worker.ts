import { Database } from "bun:sqlite";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { inspectClosedCache } from "./inspect.ts";
import type { RecoveryWorkerReply, RecoveryWorkerRequest } from "./protocol-types.ts";

export async function checkpointCandidate(
  request: Extract<RecoveryWorkerRequest, { readonly operation: "checkpoint" }>,
  signal: AbortSignal,
): Promise<RecoveryWorkerReply> {
  const blocked = (): RecoveryWorkerReply => ({
    version: 1,
    operation: "checkpoint",
    status: "blocked",
    code: signal.aborted ? "CANCELLED" : "CANDIDATE_CHECKPOINT_FAILED",
  });
  let db: Database | undefined;
  let result: RecoveryWorkerReply;
  try {
    if ((await realpath(request.workDirectory)) !== request.workDirectory) return blocked();
    const file = path.join(request.workDirectory, request.candidateFilename);
    const before = await lstat(file, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size > BigInt(request.candidateMaxBytes)
    )
      return blocked();
    db = new Database(file, { create: false, strict: true });
    db.exec("PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF;");
    db.exec("INSERT INTO object_fts(object_fts, rank) VALUES('integrity-check', 1);");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.exec("PRAGMA journal_mode=DELETE;");
    db.close();
    db = undefined;
    const candidate = await inspectClosedCache({
      authorizedDirectory: request.workDirectory,
      relativeFilename: request.candidateFilename,
      maxBytes: request.candidateMaxBytes,
      signal,
    });
    result =
      candidate.status === "accepted" &&
      candidate.embeddingCount === 0 &&
      candidate.device === before.dev.toString() &&
      candidate.inode === before.ino.toString()
        ? {
            version: 1,
            operation: "checkpoint",
            status: "ok",
            checksum: candidate.checksum,
            byteLength: candidate.byteLength,
            device: candidate.device,
            inode: candidate.inode,
            objectCount: candidate.objectCount,
            embeddingCount: candidate.embeddingCount,
          }
        : blocked();
  } catch {
    result = blocked();
  }
  try {
    db?.close();
  } catch {
    return blocked();
  }
  return result;
}
