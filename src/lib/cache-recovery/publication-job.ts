import path from "node:path";
import type { CandidateProduct } from "./candidate.ts";
import type { CacheRecoveryOutcome, Snapshot, WorkerInvoker } from "./controller-types.ts";
import { createReceipt, outcome, workerRequest } from "./controller-types.ts";
import { recoveryCheckpoint } from "./faults.ts";
import {
  type CacheRevision,
  publishCandidate,
  retainVerifiedBackup,
  rollbackVerifiedBackup,
} from "./publication.ts";
import type { RecoveryLayout, RecoveryReceipt } from "./receipt-types.ts";

export async function publishRebuiltCache(options: {
  readonly snapshot: Snapshot;
  readonly targetKey: string;
  readonly actionId: string;
  readonly cacheRoot: string;
  readonly sourceRoot: string;
  readonly targetPath: string;
  readonly layout: RecoveryLayout;
  readonly candidate: CandidateProduct;
  readonly targetRevision: CacheRevision;
  readonly invoke: WorkerInvoker;
  readonly signal: AbortSignal;
  readonly persist: (receipt: RecoveryReceipt) => Promise<boolean>;
}): Promise<CacheRecoveryOutcome> {
  const {
    snapshot,
    targetKey,
    actionId,
    cacheRoot,
    targetPath,
    layout,
    candidate,
    targetRevision,
  } = options;
  const save = (phase: RecoveryReceipt["phase"], code?: string) =>
    options.persist(
      createReceipt(targetKey, actionId, candidate.fingerprint, targetRevision.checksum, phase, {
        candidateChecksum: candidate.checksum,
        ...(phase === "completed" ? { publishedChecksum: candidate.checksum } : {}),
        ...(code === undefined ? {} : { code }),
      }),
    );
  const backupPath = path.join(layout.backups, `${actionId}.old.sqlite`);
  await recoveryCheckpoint("before-backup");
  const backup = await retainVerifiedBackup(
    targetPath,
    backupPath,
    targetRevision,
    snapshot.maxCacheBytes,
  );
  if (backup.status !== "ok") {
    if (!(await save("failed", "BACKUP_FAILED")))
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    return outcome("failed", "BACKUP_FAILED", actionId);
  }
  if (!(await save("backup"))) return outcome("failed", "RECEIPT_IO", actionId);
  if (options.signal.aborted) {
    if (!(await save("failed", "CANCELLED")))
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    return outcome("cancelled", "CANCELLED", actionId);
  }
  if (!(await save("publishing"))) return outcome("failed", "RECEIPT_IO", actionId);
  if (options.signal.aborted) {
    if (!(await save("failed", "CANCELLED")))
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    return outcome("cancelled", "CANCELLED", actionId);
  }
  const publish = await publishCandidate(
    candidate.path,
    targetPath,
    targetRevision,
    candidate.checksum,
    snapshot.maxCacheBytes,
  );
  if (publish.status === "blocked") {
    if (!(await save("failed", "PUBLISH_FAILED")))
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    return outcome("failed", "PUBLISH_FAILED", actionId);
  }
  let injectedFailure = false;
  try {
    await recoveryCheckpoint("after-publish");
  } catch {
    injectedFailure = true;
  }
  const postcheckResult =
    publish.status === "ok" && !injectedFailure
      ? await options.invoke({
          version: 1,
          operation: "verify",
          root: cacheRoot,
          relativeFilename: snapshot.relativeTarget,
          maxBytes: snapshot.maxCacheBytes,
          sourceRoot: options.sourceRoot,
          expectedFingerprint: candidate.fingerprint,
          expectedChecksum: candidate.checksum,
        })
      : undefined;
  const postcheck = postcheckResult ? workerRequest(postcheckResult, "verify") : undefined;
  if (
    publish.status !== "ok" ||
    !postcheck ||
    postcheck.status !== "ok" ||
    postcheck.checksum !== candidate.checksum ||
    postcheck.objectCount !== candidate.files ||
    postcheck.embeddingCount !== 0 ||
    postcheck.device !== publish.revision.device ||
    postcheck.inode !== publish.revision.inode
  ) {
    const preserved = await retainVerifiedBackup(
      targetPath,
      candidate.path,
      publish.revision,
      snapshot.maxCacheBytes,
    );
    if (preserved.status !== "ok") {
      await save("publishing", "ROLLBACK_UNRESOLVED");
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    }
    const rollback = await rollbackVerifiedBackup(
      backupPath,
      targetPath,
      publish.revision,
      targetRevision.checksum,
      path.join(layout.rollback, `${actionId}.rollback.sqlite`),
      snapshot.maxCacheBytes,
    );
    if (rollback.status !== "ok") {
      await save("publishing", "ROLLBACK_UNRESOLVED");
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    }
    if (!(await save("failed", "POSTCHECK_ROLLED_BACK")))
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    return outcome("failed", "POSTCHECK_ROLLED_BACK", actionId);
  }
  if (!(await save("completed"))) return outcome("blocked", "MANUAL_INSPECTION", actionId);
  return {
    status: "recovered",
    code: "CACHE_REBUILT",
    actionId,
    files: candidate.files,
    bytes: candidate.bytes,
    objects: candidate.objects,
    semantic: "unavailable",
    assurance: "observed-source-rechecked-metadata-only",
  };
}
