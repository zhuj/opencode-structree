import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import type { SqliteProcessLock } from "../sqlite/process-lock.ts";
import { errorCode } from "../vault/confined-directory.ts";
import { ConfinedFilesystem } from "../vault/confined-filesystem.ts";
import { SourceRepairError } from "./apply.ts";
import type { SourceRepairOptions } from "./types.ts";

export interface RepairWriter {
  readonly files: ConfinedFilesystem;
  readonly coordinator: SqliteProcessLock;
}

export async function openRepairWriter(
  settings: Required<SourceRepairOptions>,
  canonicalRoot: string,
  rootIdentity: { readonly dev: number | bigint; readonly ino: number | bigint },
): Promise<RepairWriter> {
  const files = new ConfinedFilesystem(settings.root, {
    createRoot: false,
    maxFileBytes: settings.maxBytes,
    confinement: settings.confinement,
  });
  try {
    await files.initialize();
    const identity = await stat(files.root);
    if (
      files.root !== canonicalRoot ||
      identity.dev !== rootIdentity.dev ||
      identity.ino !== rootIdentity.ino
    )
      throw new SourceRepairError("ROOT_CHANGED", "Repair root identity changed.");
    const coordinatorPath = path.join(canonicalRoot, ".object-mcp-lock.sqlite");
    await assertSafeCoordinatorPaths(coordinatorPath);
    const { SqliteProcessLock: ProcessLock } = await import("../sqlite/process-lock.ts");
    const coordinator = await ProcessLock.open({
      path: coordinatorPath,
      driver: settings.driver,
      timeoutMs: settings.lockTimeoutMs,
    });
    return { files, coordinator };
  } catch (error) {
    await files.close();
    throw error;
  }
}

async function assertSafeCoordinatorPaths(coordinatorPath: string): Promise<void> {
  for (const candidate of [
    coordinatorPath,
    `${coordinatorPath}-journal`,
    `${coordinatorPath}-wal`,
    `${coordinatorPath}-shm`,
  ]) {
    try {
      const details = await lstat(candidate);
      if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1)
        throw new SourceRepairError(
          "COORDINATION_UNSAFE",
          "The repair coordination path is not a regular file.",
        );
    } catch (error) {
      if (error instanceof SourceRepairError) throw error;
      if (errorCode(error) === "ENOENT") continue;
      throw new SourceRepairError(
        "COORDINATION_UNSAFE",
        "The repair coordination path cannot be safely inspected.",
      );
    }
  }
}
