import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { buildVerifiedCandidate } from "./candidate.ts";
import {
  type CacheRecoveryOutcome,
  cacheRecoveryActionId,
  createReceipt,
  outcome,
  pathsOverlap,
  type Snapshot,
  workerFailure,
  workerRequest,
} from "./controller-types.ts";
import type { RecoveryWorkerRequest } from "./protocol-types.ts";
import { publishRebuiltCache } from "./publication-job.ts";
import { preflightRecoveryReceipts } from "./receipt-preflight.ts";
import type { RecoveryLayout, RecoveryReceipt } from "./receipt-types.ts";
import { openRecoveryLayout, persistReceipt } from "./receipts.ts";
import { runRecoveryWorker, type WorkerResult } from "./worker-client.ts";

export async function executeRecoveryJob(
  snapshot: Snapshot,
  targetKey: string,
  lifecycleSignal: AbortSignal,
  callerSignal: AbortSignal,
): Promise<CacheRecoveryOutcome> {
  const deadline = Date.now() + snapshot.totalBudgetMs;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), snapshot.totalBudgetMs);
  const signal = AbortSignal.any([lifecycleSignal, callerSignal, timeout.signal]);
  const invoke = async (request: RecoveryWorkerRequest): Promise<WorkerResult> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: "blocked", code: "WORKER_TIMEOUT" };
    const result = await runRecoveryWorker({
      entrypoint: snapshot.workerEntrypoint,
      cwd: path.resolve(snapshot.authorizedDirectory),
      request,
      timeoutMs: remaining,
      signal,
    });
    return result.status === "blocked" &&
      result.code === "CANCELLED" &&
      timeout.signal.aborted &&
      !callerSignal.aborted &&
      !lifecycleSignal.aborted
      ? { status: "blocked", code: "WORKER_TIMEOUT" }
      : result;
  };
  let actionId: string | undefined;
  let currentReceipt: RecoveryReceipt | undefined;
  let layout: RecoveryLayout | undefined;
  const persist = async (next: RecoveryReceipt): Promise<boolean> => {
    if (!layout) return false;
    currentReceipt = next;
    try {
      return await persistReceipt(layout, next);
    } catch {
      return false;
    }
  };
  try {
    const cacheRoot = path.resolve(snapshot.authorizedDirectory);
    const sourceRoot = path.resolve(snapshot.sourceRoot);
    const workerEntry = path.resolve(snapshot.workerEntrypoint);
    if (
      (await realpath(cacheRoot)) !== cacheRoot ||
      (await realpath(sourceRoot)) !== sourceRoot ||
      (await realpath(workerEntry)) !== workerEntry
    )
      return outcome("blocked", "UNSAFE_ROOT");
    const targetPath = path.join(cacheRoot, ...snapshot.relativeTarget.split("/"));
    if (path.resolve(snapshot.sqlite.path) !== targetPath || pathsOverlap(sourceRoot, targetPath))
      return outcome("blocked", "PATH_OVERLAP");
    const workRoot = path.join(cacheRoot, ".object-mcp-cache-recovery");
    if (pathsOverlap(sourceRoot, workRoot)) return outcome("blocked", "NO_DISJOINT_WORK_AREA");
    const rootStat = await lstat(cacheRoot, { bigint: true });
    const sourceStat = await lstat(sourceRoot, { bigint: true });
    const workerStat = await lstat(workerEntry, { bigint: true });
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      !sourceStat.isDirectory() ||
      sourceStat.isSymbolicLink() ||
      !workerStat.isFile() ||
      workerStat.isSymbolicLink() ||
      workerStat.nlink !== 1n
    )
      return outcome("blocked", "UNSAFE_ROOT");

    const retained = await preflightRecoveryReceipts(cacheRoot, targetKey, snapshot.maxReceipts);
    if (retained?.status === "blocked") return outcome("blocked", retained.code);
    if (
      retained?.status === "ready" &&
      retained.receipts.some((item) => item.phase !== "completed" && item.phase !== "failed")
    )
      return outcome("blocked", "MANUAL_INSPECTION");

    const targetResult = await invoke({
      version: 1,
      operation: "inspect",
      root: cacheRoot,
      relativeFilename: snapshot.relativeTarget,
      maxBytes: snapshot.maxCacheBytes,
    });
    const target = workerRequest(targetResult, "inspect");
    if (target?.status !== "ok") {
      if (target?.status === "blocked" && target.code === "CANCELLED")
        return outcome("cancelled", "CANCELLED");
      if (targetResult.status === "blocked") return workerFailure(targetResult);
      return outcome("blocked", "TARGET_NOT_ADMISSIBLE");
    }
    if (target.device !== rootStat.dev.toString())
      return outcome("blocked", "NO_DISJOINT_WORK_AREA");
    if (signal.aborted)
      return timeout.signal.aborted && !callerSignal.aborted && !lifecycleSignal.aborted
        ? outcome("failed", "WORKER_TIMEOUT")
        : outcome("cancelled", "CANCELLED");
    const sourceResult = await invoke({ version: 1, operation: "collect", sourceRoot });
    const collected = workerRequest(sourceResult, "collect");
    if (collected?.status !== "ok") return workerFailure(sourceResult, collected);
    const layoutResult = await openRecoveryLayout(cacheRoot, targetKey, snapshot.maxReceipts);
    if (layoutResult.status !== "ready") return outcome("blocked", layoutResult.code);
    layout = layoutResult.layout;
    if (layout.device !== rootStat.dev) return outcome("blocked", "UNSAFE_WORK_AREA");
    if (layoutResult.receipts.some((item) => item.phase !== "completed" && item.phase !== "failed"))
      return outcome("blocked", "MANUAL_INSPECTION");

    const already = layoutResult.receipts.find(
      (item) =>
        item.phase === "completed" &&
        item.sourceFingerprint === collected.fingerprint &&
        item.publishedChecksum === target.checksum &&
        item.actionId ===
          cacheRecoveryActionId(targetKey, sourceRoot, item.oldChecksum, collected.fingerprint),
    );
    if (already) {
      const verifiedResult = await invoke({
        version: 1,
        operation: "verify",
        root: cacheRoot,
        relativeFilename: snapshot.relativeTarget,
        maxBytes: snapshot.maxCacheBytes,
        sourceRoot,
        expectedFingerprint: collected.fingerprint,
        expectedChecksum: target.checksum,
      });
      const verified = workerRequest(verifiedResult, "verify");
      if (
        verified?.status !== "ok" ||
        verified.device !== target.device ||
        verified.inode !== target.inode
      )
        return outcome("blocked", "MANUAL_INSPECTION", already.actionId);
      return {
        status: "already-satisfied",
        code: "CACHE_CURRENT",
        actionId: already.actionId,
        files: collected.files,
        bytes: collected.bytes,
        objects: target.objectCount,
        semantic: "unavailable",
        assurance: "observed-source-rechecked-metadata-only",
      };
    }
    if (layoutResult.receipts.some((item) => Date.now() - item.attemptedAt < 30_000))
      return outcome("blocked", "TARGET_COOLDOWN");
    actionId = cacheRecoveryActionId(targetKey, sourceRoot, target.checksum, collected.fingerprint);
    if (layoutResult.receipts.length >= snapshot.maxReceipts)
      return outcome("blocked", "RECEIPT_LIMIT", actionId);
    if (layoutResult.receipts.some((item) => item.actionId === actionId))
      return outcome("blocked", "ACTION_ALREADY_ATTEMPTED", actionId);
    if (
      !(await persist(
        createReceipt(targetKey, actionId, collected.fingerprint, target.checksum, "started"),
      ))
    )
      return outcome("blocked", "RECEIPT_IO", actionId);

    const candidate = await buildVerifiedCandidate({
      snapshot,
      targetKey,
      actionId,
      cacheRoot,
      sourceRoot,
      target,
      collected,
      layout,
      invoke,
      persist,
    });
    if (candidate.status === "outcome") return candidate.outcome;
    return await publishRebuiltCache({
      snapshot,
      targetKey,
      actionId,
      cacheRoot,
      targetPath,
      sourceRoot,
      layout,
      candidate: candidate.product,
      targetRevision: { checksum: target.checksum, device: target.device, inode: target.inode },
      invoke,
      signal,
      persist,
    });
  } catch {
    if (
      currentReceipt &&
      layout &&
      currentReceipt.phase !== "publishing" &&
      currentReceipt.phase !== "completed"
    )
      await persist(
        createReceipt(
          targetKey,
          currentReceipt.actionId,
          currentReceipt.sourceFingerprint,
          currentReceipt.oldChecksum,
          "failed",
          {
            ...(currentReceipt.candidateChecksum === undefined
              ? {}
              : { candidateChecksum: currentReceipt.candidateChecksum }),
            code: "JOB_FAILED",
          },
        ),
      );
    if (currentReceipt?.phase === "publishing" || currentReceipt?.phase === "completed")
      return outcome("blocked", "MANUAL_INSPECTION", actionId);
    return timeout.signal.aborted && !callerSignal.aborted && !lifecycleSignal.aborted
      ? outcome("failed", "WORKER_TIMEOUT", actionId)
      : outcome(
          signal.aborted ? "cancelled" : "failed",
          signal.aborted ? "CANCELLED" : "JOB_FAILED",
          actionId,
        );
  } finally {
    clearTimeout(timer);
  }
}
