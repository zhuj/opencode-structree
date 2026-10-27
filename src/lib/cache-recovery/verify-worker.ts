import { constants, Database } from "bun:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { documentLabels } from "../read-document.ts";
import type { ObjectDefinition } from "../types.ts";
import { inspectClosedCache } from "./inspect.ts";
import type { RecoveryWorkerReply, RecoveryWorkerRequest } from "./protocol-types.ts";
import { collectCacheSources } from "./sources.ts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export async function verifyCandidateProjection(
  request: Extract<RecoveryWorkerRequest, { readonly operation: "verify" }>,
  signal: AbortSignal,
  options: { readonly definitions: readonly ObjectDefinition[] },
): Promise<RecoveryWorkerReply> {
  const blocked = (
    code: "CANDIDATE_METADATA" | "SOURCE_CHANGED" | "SOURCE_INCOMPLETE" | "CANCELLED",
  ): RecoveryWorkerReply => ({ version: 1, operation: "verify", status: "blocked", code });
  if (!options.definitions.length) return blocked("SOURCE_INCOMPLETE");
  let db: Database | undefined;
  let result: RecoveryWorkerReply;
  try {
    const before = await inspectClosedCache({
      authorizedDirectory: request.root,
      relativeFilename: request.relativeFilename,
      maxBytes: request.maxBytes,
      signal,
    });
    if (
      before.status !== "accepted" ||
      before.checksum !== request.expectedChecksum ||
      before.embeddingCount !== 0
    )
      return blocked("CANDIDATE_METADATA");
    const sources = await collectCacheSources({
      root: request.sourceRoot,
      definitions: options.definitions,
      signal,
    });
    if (sources.status !== "complete")
      return blocked(signal.aborted ? "CANCELLED" : "SOURCE_INCOMPLETE");
    if (sources.fingerprint !== request.expectedFingerprint) return blocked("SOURCE_CHANGED");
    if (sources.files !== before.objectCount) return blocked("CANDIDATE_METADATA");
    const url = pathToFileURL(path.join(request.root, request.relativeFilename));
    url.searchParams.set("mode", "ro");
    url.searchParams.set("immutable", "1");
    db = new Database(url.href, constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI);
    const metadata = db.query("SELECT * FROM object_meta WHERE object_key = ?");
    const fulltext = db.query(
      "SELECT object_key, name, title, raw FROM object_fts WHERE object_key = ? LIMIT 2",
    );
    let agrees = true;
    for (const document of sources.documents) {
      signal.throwIfAborted();
      const row: unknown = metadata.get(document.key);
      const indexed: unknown[] = fulltext.all(document.key);
      const fts: unknown = indexed[0];
      const labels = documentLabels(document);
      const json = JSON.stringify(
        document.partial ? { ...document.json, id: labels.id } : document.json,
      );
      if (
        !record(row) ||
        !record(fts) ||
        indexed.length !== 1 ||
        row.object_key !== document.key ||
        row.object_type !== document.type ||
        row.id !== labels.id ||
        row.name !== labels.name ||
        row.title !== labels.title ||
        row.path !== document.path ||
        row.checksum !== document.checksum ||
        row.raw !== document.raw ||
        row.body !== document.body ||
        row.json !== json ||
        row.embedding_chunks !== 0 ||
        row.embedding_checksum !== null ||
        row.embedding_fingerprint !== null ||
        row.embedding_dimensions !== null ||
        fts.object_key !== document.key ||
        fts.name !== labels.name ||
        fts.title !== labels.title ||
        fts.raw !== document.raw
      ) {
        agrees = false;
        break;
      }
    }
    const ftsCount: unknown = db.query("SELECT COUNT(*) AS count FROM object_fts").get();
    if (!record(ftsCount) || ftsCount.count !== sources.files) agrees = false;
    db.close();
    db = undefined;
    const after = await inspectClosedCache({
      authorizedDirectory: request.root,
      relativeFilename: request.relativeFilename,
      maxBytes: request.maxBytes,
      signal,
    });
    result =
      agrees &&
      after.status === "accepted" &&
      after.checksum === before.checksum &&
      after.device === before.device &&
      after.inode === before.inode
        ? {
            version: 1,
            operation: "verify",
            status: "ok",
            checksum: after.checksum,
            byteLength: after.byteLength,
            device: after.device,
            inode: after.inode,
            objectCount: after.objectCount,
            embeddingCount: after.embeddingCount,
          }
        : blocked("CANDIDATE_METADATA");
  } catch {
    result = blocked(signal.aborted ? "CANCELLED" : "CANDIDATE_METADATA");
  }
  try {
    db?.close();
  } catch {
    return blocked("CANDIDATE_METADATA");
  }
  return result;
}
