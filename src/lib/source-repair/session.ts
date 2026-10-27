import { stat } from "node:fs/promises";
import { FrameworkError } from "../errors.ts";
import { checksum } from "../vault/checksums.ts";
import { errorCode } from "../vault/confined-directory.ts";
import { ConfinedFilesystem } from "../vault/confined-filesystem.ts";
import type { PreparedRepairCall } from "./apply.ts";
import {
  bytesFromPlan,
  conflict,
  ensureBackup,
  prepareRepairCall,
  result,
  SourceRepairError,
  safePath,
} from "./apply.ts";
import { makePlan, planChanged, snapshotOptions } from "./plan.ts";
import type { AnySourceRepairPlan, SourceRepairOptions, SourceRepairSession } from "./types.ts";
import { openRepairWriter, type RepairWriter } from "./writer.ts";

export async function createSourceRepairSession(
  options: SourceRepairOptions,
): Promise<SourceRepairSession> {
  const settings = snapshotOptions(options);
  const readFiles = new ConfinedFilesystem(settings.root, {
    readOnly: true,
    createRoot: false,
    maxFileBytes: settings.maxBytes,
    confinement: settings.confinement,
  });
  try {
    await readFiles.initialize();
  } catch {
    await readFiles.close();
    throw new SourceRepairError("ROOT_UNAVAILABLE", "The repair root is unavailable.");
  }
  const canonicalRoot = readFiles.root;
  let rootIdentity: Awaited<ReturnType<typeof stat>>;
  try {
    rootIdentity = await stat(canonicalRoot);
  } catch {
    await readFiles.close();
    throw new SourceRepairError("ROOT_UNAVAILABLE", "The repair root is unavailable.");
  }
  const closed = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let writer: RepairWriter | undefined;
  let writablePromise: Promise<RepairWriter> | undefined;
  let closePromise: Promise<void> | undefined;
  const ensureOpen = () => {
    if (closed.signal.aborted) throw new SourceRepairError("CLOSED", "Repair session is closed.");
  };
  const withWork = <T>(work: () => Promise<T>): Promise<T> => {
    ensureOpen();
    const task = Promise.resolve()
      .then(work)
      .catch((error: unknown) => {
        if (error instanceof SourceRepairError) throw error;
        if (error instanceof FrameworkError)
          throw new SourceRepairError(
            error.code,
            "Repair operation was blocked by the source boundary.",
          );
        if (error instanceof Error && error.name === "AbortError")
          throw new SourceRepairError("ABORTED", "Repair operation was aborted.");
        throw new SourceRepairError("SOURCE_IO", "Source repair operation could not be completed.");
      });
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => undefined);
    return task;
  };
  const replacementPlan = (input: Parameters<SourceRepairSession["planReplacement"]>[0]) => {
    const snapshot = {
      sourcePath: input.sourcePath,
      payload: Uint8Array.from(input.payload),
      ...(input.expectedChecksum === undefined ? {} : { expectedChecksum: input.expectedChecksum }),
    };
    return withWork(() =>
      planChanged(readFiles, settings.maxBytes, "replace", snapshot, closed.signal),
    );
  };
  const patchPlan = (input: Parameters<SourceRepairSession["planPatch"]>[0]) => {
    const snapshot = {
      sourcePath: input.sourcePath,
      edits: input.edits.map((edit) => ({ ...edit, insert: Uint8Array.from(edit.insert) })),
      ...(input.expectedChecksum === undefined ? {} : { expectedChecksum: input.expectedChecksum }),
    };
    return withWork(() =>
      planChanged(readFiles, settings.maxBytes, "patch", snapshot, closed.signal),
    );
  };
  const writable = (): Promise<RepairWriter> => {
    if (writablePromise) return writablePromise;
    writablePromise = openRepairWriter(settings, canonicalRoot, rootIdentity).then((value) => {
      writer = value;
      return value;
    });
    void writablePromise.catch(() => {
      writablePromise = undefined;
    });
    return writablePromise;
  };
  const applyPlan = async (plan: AnySourceRepairPlan, approval: PreparedRepairCall["approval"]) => {
    if (plan.operation === "replace" || plan.operation === "patch") {
      if (plan.sourcePath === plan.backupPath) conflict();
    }
    if (plan.operation === "salvage" && plan.sourcePath === plan.destinationPath) conflict();
    if (plan.operation === "salvage" && plan.destinationPath === plan.backupPath) conflict();
    const { files, coordinator } = await writable();
    const signal = approval.signal
      ? AbortSignal.any([closed.signal, approval.signal])
      : closed.signal;
    return coordinator.run(async () => {
      signal.throwIfAborted();
      const target = plan.operation === "salvage" ? plan.destinationPath : plan.sourcePath;
      safePath(target);
      const desired = bytesFromPlan(plan, settings.maxBytes);
      if (plan.operation === "draft") {
        const existing = await files.readBytes(target, signal).catch((error: unknown) => {
          if (errorCode(error) === "ENOENT") return undefined;
          throw error;
        });
        if (existing) {
          if (checksum(existing) === plan.afterChecksum) return result("already-applied", target);
          conflict();
        }
        await files.writeBytes(target, desired, { expectedChecksum: null }, signal);
        return result("committed", target);
      }
      if (plan.operation === "salvage") {
        const source = await files.readBytes(plan.sourcePath, signal);
        if (checksum(source) !== plan.beforeChecksum || checksum(source) !== plan.afterChecksum)
          conflict();
        const existing = await files.readBytes(target, signal).catch((error: unknown) => {
          if (errorCode(error) === "ENOENT") return undefined;
          throw error;
        });
        if (existing) {
          if (checksum(existing) === plan.afterChecksum) return result("already-applied", target);
          conflict();
        }
        await files.writeBytes(target, source, { expectedChecksum: null }, signal);
        return result("committed", target);
      }
      let current: Uint8Array;
      try {
        current = await files.readBytes(plan.sourcePath, signal);
      } catch (error) {
        if (errorCode(error) === "ENOENT") conflict();
        throw error;
      }
      const currentHash = checksum(current);
      if (currentHash === plan.afterChecksum) {
        const backup = await files.readBytes(plan.backupPath, signal).catch(() => undefined);
        if (backup && checksum(backup) === plan.beforeChecksum)
          return result("already-applied", plan.sourcePath);
      }
      if (currentHash !== plan.beforeChecksum || plan.beforeChecksum === null) conflict();
      await ensureBackup(files, plan.backupPath, current, signal);
      await files.writeBytes(
        plan.sourcePath,
        desired,
        { expectedChecksum: plan.beforeChecksum },
        signal,
      );
      return result("committed", plan.sourcePath);
    }, signal);
  };
  const rollback = async (plan: AnySourceRepairPlan, approval: PreparedRepairCall["approval"]) => {
    if (plan.operation !== "replace")
      throw new SourceRepairError("UNSUPPORTED", "Only replacement plans can be rolled back.");
    const { files, coordinator } = await writable();
    const signal = approval.signal
      ? AbortSignal.any([closed.signal, approval.signal])
      : closed.signal;
    return coordinator.run(async () => {
      signal.throwIfAborted();
      const original = await files.readBytes(plan.backupPath, signal);
      if (checksum(original) !== plan.beforeChecksum) conflict();
      const current = await files.readBytes(plan.sourcePath, signal);
      const currentHash = checksum(current);
      const rollbackPath = `.object-mcp-recovery/backups/${plan.actionId}.rollback.bak`;
      if (currentHash === plan.beforeChecksum) {
        const rollbackBackup = await files.readBytes(rollbackPath, signal).catch(() => undefined);
        if (rollbackBackup && checksum(rollbackBackup) === plan.afterChecksum)
          return result("already-applied", plan.sourcePath);
        conflict();
      }
      if (currentHash !== plan.afterChecksum) conflict();
      await ensureBackup(files, rollbackPath, current, signal);
      await files.writeBytes(
        plan.sourcePath,
        original,
        { expectedChecksum: plan.afterChecksum },
        signal,
      );
      return result("committed", plan.sourcePath);
    }, signal);
  };
  const session: SourceRepairSession = {
    planReplacement: replacementPlan,
    planPatch: patchPlan,
    planDraft: (input) => {
      const sourcePath = input.sourcePath;
      const payload = Uint8Array.from(input.payload);
      return withWork(async () => {
        if (payload.byteLength > settings.maxBytes) throw new RangeError("Draft exceeds maxBytes.");
        return makePlan("draft", sourcePath, null, payload);
      });
    },
    planSalvage: (input) => {
      const sourcePath = input.sourcePath;
      const destinationPath = input.destinationPath;
      return withWork(async () => {
        safePath(destinationPath);
        const source = await readFiles.readBytes(sourcePath, closed.signal);
        if (source.byteLength > settings.maxBytes) throw new RangeError("Source exceeds maxBytes.");
        return makePlan("salvage", sourcePath, source, source, { destinationPath });
      });
    },
    apply: (plan, approval) => {
      const captured = prepareRepairCall(plan, approval, settings.maxBytes, ensureOpen);
      if ("failure" in captured) return Promise.reject(captured.failure);
      return withWork(() => applyPlan(captured.prepared.plan, captured.prepared.approval));
    },
    rollbackReplace: (plan, approval) => {
      const captured = prepareRepairCall(plan, approval, settings.maxBytes, ensureOpen);
      if ("failure" in captured) return Promise.reject(captured.failure);
      return withWork(() => rollback(captured.prepared.plan, captured.prepared.approval));
    },
    close: () => {
      if (closePromise) return closePromise;
      closed.abort();
      closePromise = (async () => {
        await Promise.allSettled([...pending]);
        const disposal = await Promise.allSettled([
          ...(writer ? [writer.coordinator.close(), writer.files.close()] : []),
          readFiles.close(),
        ]);
        if (disposal.some((entry) => entry.status === "rejected"))
          throw new SourceRepairError(
            "CLOSE_FAILED",
            "Repair session resources could not be closed.",
          );
      })();
      return closePromise;
    },
  };
  return session;
}
