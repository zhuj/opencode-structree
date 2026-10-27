import type { CacheRecoveryOutcome, Snapshot, WorkerInvoker } from "./controller-types.ts";
import { createReceipt, outcome, workerFailure, workerRequest } from "./controller-types.ts";
import { recoveryCheckpoint } from "./faults.ts";
import type { RecoveryWorkerReply } from "./protocol-types.ts";
import type { CacheRevision } from "./publication.ts";
import type { RecoveryLayout, RecoveryReceipt } from "./receipt-types.ts";

type InspectReply = Extract<RecoveryWorkerReply, { readonly status: "ok" }> & {
  readonly operation: "inspect";
};
type CollectReply = Extract<RecoveryWorkerReply, { readonly status: "ok" }> & {
  readonly operation: "collect";
};
export interface CandidateProduct {
  readonly path: string;
  readonly checksum: string;
  readonly files: number;
  readonly bytes: number;
  readonly objects: number;
  readonly fingerprint: string;
  readonly revision: CacheRevision;
}
export type CandidateResult =
  | { readonly status: "ready"; readonly product: CandidateProduct }
  | { readonly status: "outcome"; readonly outcome: CacheRecoveryOutcome };

export async function buildVerifiedCandidate(options: {
  readonly snapshot: Snapshot;
  readonly targetKey: string;
  readonly actionId: string;
  readonly cacheRoot: string;
  readonly sourceRoot: string;
  readonly target: InspectReply;
  readonly collected: CollectReply;
  readonly layout: RecoveryLayout;
  readonly invoke: WorkerInvoker;
  readonly persist: (receipt: RecoveryReceipt) => Promise<boolean>;
}): Promise<CandidateResult> {
  const { snapshot, targetKey, actionId, cacheRoot, sourceRoot, target, collected, layout } =
    options;
  const candidateFilename = `${actionId}.candidate.sqlite`;
  const candidatePath = `${layout.candidates}/${candidateFilename}`;
  const fail = async (
    status: "blocked" | "failed" | "cancelled",
    code: import("./controller-types.ts").CacheRecoveryCode,
    candidateChecksum?: string,
  ): Promise<CandidateResult> => {
    const saved = await options.persist(
      createReceipt(targetKey, actionId, collected.fingerprint, target.checksum, "failed", {
        ...(candidateChecksum === undefined ? {} : { candidateChecksum }),
        code,
      }),
    );
    return {
      status: "outcome",
      outcome: saved
        ? outcome(status, code, actionId)
        : outcome("blocked", "MANUAL_INSPECTION", actionId),
    };
  };

  const buildResult = await options.invoke({
    version: 1,
    operation: "build",
    sourceRoot,
    workDirectory: layout.candidates,
    candidateFilename,
    expectedFingerprint: collected.fingerprint,
    candidateMaxBytes: snapshot.maxCacheBytes,
    sqlite: {
      driver: snapshot.sqlite.driver,
      busyTimeoutMs: 0,
      ...(snapshot.sqlite.extensionPath === undefined
        ? {}
        : { extensionPath: snapshot.sqlite.extensionPath }),
      ...(snapshot.sqlite.customSQLite === undefined
        ? {}
        : { customSQLite: snapshot.sqlite.customSQLite }),
    },
    search: snapshot.search,
  });
  const built = workerRequest(buildResult, "build");
  if (built?.status !== "ok") {
    const failure = workerFailure(buildResult, built);
    return fail(failure.status, failure.code);
  }
  if (
    built.fingerprint !== collected.fingerprint ||
    built.files !== collected.files ||
    built.objectCount !== built.files ||
    built.embeddingCount !== 0
  )
    return fail("failed", "CANDIDATE_MISMATCH");

  const checkpointResult = await options.invoke({
    version: 1,
    operation: "checkpoint",
    workDirectory: layout.candidates,
    candidateFilename,
    candidateMaxBytes: snapshot.maxCacheBytes,
  });
  const checkpoint = workerRequest(checkpointResult, "checkpoint");
  if (
    checkpoint?.status !== "ok" ||
    checkpoint.objectCount !== built.files ||
    checkpoint.embeddingCount !== 0
  ) {
    const failure = workerFailure(checkpointResult, checkpoint);
    return fail(failure.status, failure.code);
  }
  if (
    !(await options.persist(
      createReceipt(targetKey, actionId, collected.fingerprint, target.checksum, "candidate", {
        candidateChecksum: checkpoint.checksum,
      }),
    ))
  )
    return fail("failed", "RECEIPT_IO", checkpoint.checksum);

  const candidateCheckResult = await options.invoke({
    version: 1,
    operation: "verify",
    root: layout.candidates,
    relativeFilename: candidateFilename,
    maxBytes: snapshot.maxCacheBytes,
    sourceRoot,
    expectedFingerprint: collected.fingerprint,
    expectedChecksum: checkpoint.checksum,
  });
  const candidate = workerRequest(candidateCheckResult, "verify");
  if (candidate?.status !== "ok") {
    const failure = workerFailure(candidateCheckResult, candidate);
    return fail(failure.status, failure.code, checkpoint.checksum);
  }
  if (
    candidate.checksum !== checkpoint.checksum ||
    candidate.objectCount !== built.files ||
    candidate.embeddingCount !== 0 ||
    candidate.device !== target.device
  )
    return fail("failed", "CANDIDATE_MISMATCH", checkpoint.checksum);

  await recoveryCheckpoint("candidate-verified");
  const sourceCheckResult = await options.invoke({ version: 1, operation: "collect", sourceRoot });
  const sourceCheck = workerRequest(sourceCheckResult, "collect");
  if (sourceCheck?.status !== "ok") {
    const failure = workerFailure(sourceCheckResult, sourceCheck);
    return fail(failure.status, failure.code, checkpoint.checksum);
  }
  if (sourceCheck.fingerprint !== collected.fingerprint)
    return fail("failed", "SOURCE_CHANGED", checkpoint.checksum);
  const targetCheckResult = await options.invoke({
    version: 1,
    operation: "inspect",
    root: cacheRoot,
    relativeFilename: snapshot.relativeTarget,
    maxBytes: snapshot.maxCacheBytes,
  });
  const targetCheck = workerRequest(targetCheckResult, "inspect");
  if (targetCheck?.status !== "ok") {
    const failure = workerFailure(targetCheckResult, targetCheck);
    return fail(failure.status, failure.code, checkpoint.checksum);
  }
  if (
    targetCheck.checksum !== target.checksum ||
    targetCheck.device !== target.device ||
    targetCheck.inode !== target.inode
  )
    return fail("blocked", "TARGET_CHANGED", checkpoint.checksum);
  return {
    status: "ready",
    product: {
      path: candidatePath,
      checksum: checkpoint.checksum,
      files: built.files,
      bytes: built.bytes,
      objects: checkpoint.objectCount,
      fingerprint: collected.fingerprint,
      revision: {
        checksum: checkpoint.checksum,
        device: checkpoint.device,
        inode: checkpoint.inode,
      },
    },
  };
}
