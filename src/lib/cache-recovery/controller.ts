import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import {
  type CacheRecoveryController,
  type CacheRecoveryControllerOptions,
  type CacheRecoveryOutcome,
  copyOptions,
  digest,
  outcome,
  safeRelativeTarget,
  validBounds,
} from "./controller-types.ts";
import { executeRecoveryJob } from "./job.ts";

const targetJobs = new Map<
  string,
  { readonly binding: string; readonly job: Promise<CacheRecoveryOutcome> }
>();

export type {
  CacheRecoveryController,
  CacheRecoveryControllerOptions,
  CacheRecoveryOutcome,
  ExclusiveCacheMaintenance,
  ExclusiveMaintenanceRequest,
} from "./controller-types.ts";

export function createCacheRecoveryController(
  options: CacheRecoveryControllerOptions,
): CacheRecoveryController {
  const snapshot = copyOptions(options);
  const fixedTarget = JSON.stringify([
    path.resolve(snapshot.authorizedDirectory),
    snapshot.relativeTarget,
  ]);
  const binding = digest(
    JSON.stringify([
      snapshot.sourceRoot,
      snapshot.workerEntrypoint,
      snapshot.sqlite,
      snapshot.search,
      snapshot.totalBudgetMs,
      snapshot.maxCacheBytes,
      snapshot.maxReceipts,
    ]),
  );
  const maintenanceOwner = Symbol("cache-recovery-maintenance");
  const maintenanceContext = new AsyncLocalStorage<symbol>();
  const lifecycle = new AbortController();
  let active: Promise<CacheRecoveryOutcome> | undefined;
  let closed = false;
  let closeResult: Promise<void> | undefined;

  async function maintain(signal: AbortSignal): Promise<CacheRecoveryOutcome> {
    if (!snapshot.enabled) return outcome("blocked", "POLICY_DISABLED");
    if (!snapshot.allowSemanticReset) return outcome("blocked", "SEMANTIC_RESET_NOT_APPROVED");
    if (!snapshot.maintenance) return outcome("blocked", "MAINTENANCE_REQUIRED");
    if (!validBounds(snapshot) || !safeRelativeTarget(snapshot.relativeTarget))
      return outcome("blocked", "INVALID_OPTIONS");
    const targetKey = digest(
      JSON.stringify([path.resolve(snapshot.authorizedDirectory), snapshot.relativeTarget]),
    );
    const cancellation = new AbortController();
    let calls = 0;
    let job: Promise<CacheRecoveryOutcome> | undefined;
    let settled = false;
    let acceptingOperation = true;
    try {
      await maintenanceContext.run(maintenanceOwner, () =>
        snapshot.maintenance?.({ targetKey, signal }, () => {
          calls++;
          if (calls !== 1 || !acceptingOperation) {
            cancellation.abort();
            return Promise.resolve(outcome("blocked", "MAINTENANCE_PROTOCOL"));
          }
          job = executeRecoveryJob(
            snapshot,
            targetKey,
            lifecycle.signal,
            AbortSignal.any([signal, cancellation.signal]),
          ).finally(() => {
            settled = true;
          });
          return job;
        }),
      );
    } catch {
      cancellation.abort();
      if (job) await job;
      return outcome("blocked", "MAINTENANCE_PROTOCOL");
    } finally {
      acceptingOperation = false;
    }
    if (calls !== 1 || !job) {
      cancellation.abort();
      if (job) await job;
      return outcome("blocked", "MAINTENANCE_PROTOCOL");
    }
    if (!settled) {
      cancellation.abort();
      await job;
      return outcome("blocked", "MAINTENANCE_PROTOCOL");
    }
    return job;
  }

  return {
    recover(request = {}) {
      if (closed) return Promise.resolve(outcome("blocked", "CONTROLLER_CLOSED"));
      if (!snapshot.enabled) return Promise.resolve(outcome("blocked", "POLICY_DISABLED"));
      if (!snapshot.allowSemanticReset)
        return Promise.resolve(outcome("blocked", "SEMANTIC_RESET_NOT_APPROVED"));
      if (!snapshot.maintenance) return Promise.resolve(outcome("blocked", "MAINTENANCE_REQUIRED"));
      if (request.signal?.aborted) return Promise.resolve(outcome("cancelled", "CANCELLED"));
      if (active) return active;
      const existing = targetJobs.get(fixedTarget);
      if (existing)
        return existing.binding === binding
          ? existing.job
          : Promise.resolve(outcome("blocked", "TARGET_BUSY"));
      const signal = request.signal
        ? AbortSignal.any([request.signal, lifecycle.signal])
        : lifecycle.signal;
      active = maintain(signal).catch(() => outcome("failed", "INTERNAL_FAILURE"));
      const job = active;
      targetJobs.set(fixedTarget, { binding, job });
      return job.finally(() => {
        if (active === job) active = undefined;
        if (targetJobs.get(fixedTarget)?.job === job) targetJobs.delete(fixedTarget);
      });
    },
    close() {
      closed = true;
      lifecycle.abort();
      // Waiting for the containing maintenance callback here would await ourselves.
      // Reject explicitly rather than falsely claiming the active job has drained.
      if (maintenanceContext.getStore() === maintenanceOwner)
        return Promise.reject(new Error("MAINTENANCE_REENTRANT_CLOSE"));
      closeResult ??= (active ?? Promise.resolve(outcome("blocked", "CONTROLLER_CLOSED"))).then(
        () => undefined,
      );
      return closeResult;
    },
  };
}
