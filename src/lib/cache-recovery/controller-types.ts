import { createHash } from "node:crypto";
import path from "node:path";
import type { FrameworkConfig } from "../types.ts";
import type { RecoveryWorkerFailure, RecoveryWorkerReply } from "./protocol.ts";
import type { RecoveryReceipt } from "./receipt-types.ts";
import type { WorkerResult } from "./worker-client.ts";

export interface ExclusiveMaintenanceRequest {
  readonly targetKey: string;
  readonly signal: AbortSignal;
}
/**
 * Trusted host precondition: fence new cache AND source owners, drain/close all relevant
 * connections/startup/watchers/reconciliation/embedding work and foreign cooperating writers.
 * Hold the fence until operation settles; reopen fresh owners only for a settled receipt.
 * MANUAL_INSPECTION and any receipt/work-area error mean keep startup fenced until
 * an operator establishes a settled state. This is not detected global quiescence.
 * A noncooperative callback cannot be forcibly interrupted by this library.
 */
export type ExclusiveCacheMaintenance = <A>(
  request: ExclusiveMaintenanceRequest,
  operation: () => Promise<A>,
) => Promise<A>;
export type CacheRecoveryCode =
  | RecoveryWorkerFailure
  | "WORKER_FAILED"
  | "WORKER_TIMEOUT"
  | "POLICY_DISABLED"
  | "SEMANTIC_RESET_NOT_APPROVED"
  | "MAINTENANCE_REQUIRED"
  | "MAINTENANCE_PROTOCOL"
  | "INVALID_OPTIONS"
  | "UNSAFE_ROOT"
  | "PATH_OVERLAP"
  | "NO_DISJOINT_WORK_AREA"
  | "TARGET_NOT_ADMISSIBLE"
  | "UNSAFE_WORK_AREA"
  | "MANUAL_INSPECTION"
  | "RECEIPT_INVALID"
  | "RECEIPT_LIMIT"
  | "RECEIPT_IO"
  | "TARGET_COOLDOWN"
  | "ACTION_ALREADY_ATTEMPTED"
  | "CANDIDATE_MISMATCH"
  | "TARGET_CHANGED"
  | "TARGET_BUSY"
  | "BACKUP_FAILED"
  | "PUBLISH_FAILED"
  | "POSTCHECK_ROLLED_BACK"
  | "JOB_FAILED"
  | "CONTROLLER_CLOSED"
  | "INTERNAL_FAILURE";
export interface CacheRecoveryControllerOptions {
  readonly enabled?: boolean;
  readonly allowSemanticReset?: boolean;
  readonly authorizedDirectory: string;
  readonly relativeTarget: string;
  readonly sourceRoot: string;
  readonly workerEntrypoint: string;
  readonly sqlite: FrameworkConfig["sqlite"];
  readonly search: FrameworkConfig["search"];
  readonly withExclusiveCacheMaintenance?: ExclusiveCacheMaintenance;
  readonly totalBudgetMs?: number;
  readonly maxCacheBytes?: number;
  readonly maxReceipts?: number;
}
interface CacheRecoveryEvidence {
  readonly actionId: string;
  readonly files: number;
  readonly bytes: number;
  readonly objects: number;
  readonly semantic: "unavailable";
  readonly assurance: "observed-source-rechecked-metadata-only";
}
export type CacheRecoveryOutcome =
  | (CacheRecoveryEvidence & { readonly status: "recovered"; readonly code: "CACHE_REBUILT" })
  | (CacheRecoveryEvidence & {
      readonly status: "already-satisfied";
      readonly code: "CACHE_CURRENT";
    })
  | CacheRecoveryFailure;
export interface CacheRecoveryFailure {
  readonly status: "blocked" | "failed" | "cancelled";
  readonly code: CacheRecoveryCode;
  readonly actionId?: string;
}
export interface CacheRecoveryController {
  recover(options?: { readonly signal?: AbortSignal }): Promise<CacheRecoveryOutcome>;
  close(): Promise<void>;
}
export type Snapshot = {
  readonly enabled: boolean;
  readonly allowSemanticReset: boolean;
  readonly authorizedDirectory: string;
  readonly relativeTarget: string;
  readonly sourceRoot: string;
  readonly workerEntrypoint: string;
  readonly sqlite: FrameworkConfig["sqlite"];
  readonly search: FrameworkConfig["search"];
  readonly maintenance?: ExclusiveCacheMaintenance;
  readonly totalBudgetMs: number;
  readonly maxCacheBytes: number;
  readonly maxReceipts: number;
};
export type OperationReply<O extends RecoveryWorkerReply["operation"]> =
  | (Extract<RecoveryWorkerReply, { readonly status: "ok" }> & { readonly operation: O })
  | (Extract<RecoveryWorkerReply, { readonly status: "blocked" }> & { readonly operation: O });
export type WorkerInvoker = (
  request: import("./protocol.ts").RecoveryWorkerRequest,
) => Promise<WorkerResult>;

export const outcome = (
  status: "blocked" | "failed" | "cancelled",
  code: CacheRecoveryCode,
  actionId?: string,
): CacheRecoveryFailure => ({ status, code, ...(actionId === undefined ? {} : { actionId }) });
export const digest = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
export function cacheRecoveryActionId(
  targetKey: string,
  sourceRoot: string,
  oldChecksum: string,
  fingerprint: string,
): string {
  return digest(
    JSON.stringify([1, "metadata-lexical-only", targetKey, sourceRoot, oldChecksum, fingerprint]),
  );
}
export const pathsOverlap = (a: string, b: string): boolean =>
  a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
export function safeRelativeTarget(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !path.posix.isAbsolute(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*\.sqlite$/.test(value)
  );
}
export function copyOptions(options: CacheRecoveryControllerOptions): Snapshot {
  const cwd = process.cwd();
  const sqlite = { ...options.sqlite };
  return {
    enabled: options.enabled === true,
    allowSemanticReset: options.allowSemanticReset === true,
    authorizedDirectory: path.resolve(cwd, options.authorizedDirectory),
    relativeTarget: options.relativeTarget,
    sourceRoot: path.resolve(cwd, options.sourceRoot),
    workerEntrypoint: path.resolve(cwd, options.workerEntrypoint),
    sqlite: {
      ...sqlite,
      path: path.resolve(cwd, sqlite.path),
      ...(sqlite.extensionPath === undefined
        ? {}
        : { extensionPath: path.resolve(cwd, sqlite.extensionPath) }),
      ...(sqlite.customSQLite === undefined
        ? {}
        : { customSQLite: path.resolve(cwd, sqlite.customSQLite) }),
    },
    search: { ...options.search },
    ...(options.withExclusiveCacheMaintenance === undefined
      ? {}
      : { maintenance: options.withExclusiveCacheMaintenance }),
    totalBudgetMs: options.totalBudgetMs ?? 60_000,
    maxCacheBytes: options.maxCacheBytes ?? 64 * 1024 * 1024,
    maxReceipts: options.maxReceipts ?? 32,
  };
}
export function validBounds(snapshot: Snapshot): boolean {
  return (
    Number.isSafeInteger(snapshot.totalBudgetMs) &&
    snapshot.totalBudgetMs > 0 &&
    snapshot.totalBudgetMs <= 120_000 &&
    Number.isSafeInteger(snapshot.maxCacheBytes) &&
    snapshot.maxCacheBytes > 0 &&
    snapshot.maxCacheBytes <= 64 * 1024 * 1024 &&
    Number.isSafeInteger(snapshot.maxReceipts) &&
    snapshot.maxReceipts > 0 &&
    snapshot.maxReceipts <= 32
  );
}
export function workerRequest(
  result: WorkerResult,
  operation: "inspect",
): OperationReply<"inspect"> | undefined;
export function workerRequest(
  result: WorkerResult,
  operation: "collect",
): OperationReply<"collect"> | undefined;
export function workerRequest(
  result: WorkerResult,
  operation: "build",
): OperationReply<"build"> | undefined;
export function workerRequest(
  result: WorkerResult,
  operation: "checkpoint",
): OperationReply<"checkpoint"> | undefined;
export function workerRequest(
  result: WorkerResult,
  operation: "verify",
): OperationReply<"verify"> | undefined;
export function workerRequest(
  result: WorkerResult,
  operation: RecoveryWorkerReply["operation"],
): RecoveryWorkerReply | undefined {
  if (result.status !== "ok" || result.reply.operation !== operation) return undefined;
  return result.reply;
}
export function workerFailure(
  result: WorkerResult,
  reply?: RecoveryWorkerReply,
): CacheRecoveryFailure {
  const code:
    | RecoveryWorkerFailure
    | Extract<WorkerResult, { readonly status: "blocked" }>["code"] =
    reply?.status === "blocked"
      ? reply.code
      : result.status === "blocked"
        ? result.code
        : "WORKER_FAILED";
  if (code === "CANCELLED") return outcome("cancelled", code);
  if (
    code === "BAD_REQUEST" ||
    code === "SOURCE_INCOMPLETE" ||
    code === "SOURCE_CHANGED" ||
    code === "CACHE_BLOCKED"
  )
    return outcome("blocked", code);
  return outcome("failed", code);
}
export function createReceipt(
  targetKey: string,
  actionId: string,
  fingerprint: string,
  oldChecksum: string,
  phase: RecoveryReceipt["phase"],
  fields: Partial<Pick<RecoveryReceipt, "candidateChecksum" | "publishedChecksum" | "code">> = {},
): RecoveryReceipt {
  return {
    version: 1,
    targetKey,
    actionId,
    sourceFingerprint: fingerprint,
    oldChecksum,
    attemptedAt: Date.now(),
    phase,
    ...fields,
  };
}
