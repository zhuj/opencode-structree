import { Buffer } from "node:buffer";
import path from "node:path";
import { checksum } from "../vault/checksums.ts";
import { errorCode, pathComponents } from "../vault/confined-directory.ts";
import type { ConfinedFilesystem } from "../vault/confined-filesystem.ts";
import { decodeRepairBase64 } from "./edits.ts";
import { repairActionId } from "./plan.ts";
import type { AnySourceRepairPlan, SourceRepairResult } from "./types.ts";

export class SourceRepairError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceRepairError";
  }
}

export interface PreparedRepairCall {
  readonly plan: AnySourceRepairPlan;
  readonly approval: { readonly approved: true; readonly signal?: AbortSignal };
}

export function prepareRepairCall(
  value: unknown,
  approval: { readonly approved: boolean; readonly signal?: AbortSignal },
  maxBytes: number,
  ensureOpen: () => void,
): { readonly prepared: PreparedRepairCall } | { readonly failure: SourceRepairError } {
  try {
    const approved = approval?.approved;
    const signal = approval?.signal;
    if (approved !== true) fail("APPROVAL_REQUIRED", "Explicit repair approval is required.");
    ensureOpen();
    if (signal !== undefined && !(signal instanceof AbortSignal))
      fail("APPROVAL_REQUIRED", "Repair cancellation signal is invalid.");
    if (signal?.aborted) fail("ABORTED", "Repair operation was aborted.");
    const plan = validatePlan(value, maxBytes);
    return { prepared: { plan, approval: { approved: true, ...(signal ? { signal } : {}) } } };
  } catch (error) {
    if (error instanceof SourceRepairError) return { failure: error };
    return { failure: new SourceRepairError("INVALID_PLAN", "Repair plan is invalid.") };
  }
}

function fail(code: string, message: string): never {
  throw new SourceRepairError(code, message);
}

const stringField = (value: Record<string, unknown>, name: string): string => {
  const field = value[name];
  if (typeof field !== "string") fail("INVALID_PLAN", "Repair plan is invalid.");
  return field;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validatePlan(value: unknown, maxBytes: number): AnySourceRepairPlan {
  if (!isRecord(value)) fail("INVALID_PLAN", "Repair plan is invalid.");
  const item = value;
  if (item.version !== 1) fail("INVALID_PLAN", "Repair plan is invalid.");
  const operation = item.operation;
  if (
    operation !== "replace" &&
    operation !== "patch" &&
    operation !== "draft" &&
    operation !== "salvage"
  )
    fail("INVALID_PLAN", "Repair plan is invalid.");
  const sourcePath = stringField(item, "sourcePath");
  const actionId = stringField(item, "actionId");
  const beforeChecksum = item.beforeChecksum;
  const afterChecksum = stringField(item, "afterChecksum");
  const backupPath = stringField(item, "backupPath");
  const payload = stringField(item, "payload");
  const destinationPath =
    operation === "salvage" ? stringField(item, "destinationPath") : undefined;
  if (operation === "salvage" && destinationPath === undefined)
    fail("INVALID_PLAN", "Repair plan destination is invalid.");
  if (
    beforeChecksum !== null &&
    (typeof beforeChecksum !== "string" || !/^[a-f0-9]{64}$/.test(beforeChecksum))
  )
    fail("INVALID_PLAN", "Repair plan is invalid.");
  if (
    (operation === "draft" && beforeChecksum !== null) ||
    ((operation === "replace" || operation === "patch") && beforeChecksum === null) ||
    (operation === "salvage" && beforeChecksum === null)
  )
    fail("INVALID_PLAN", "Repair plan revision is invalid.");
  let bytes: Uint8Array;
  try {
    bytes = decodeRepairBase64(payload, maxBytes);
  } catch {
    fail("INVALID_PLAN", "Repair plan payload is invalid.");
  }
  if (
    !Number.isSafeInteger(item.afterSize) ||
    item.afterSize !== bytes.byteLength ||
    checksum(bytes) !== afterChecksum ||
    repairActionId({
      operation,
      sourcePath,
      beforeChecksum,
      afterChecksum,
      afterSize: bytes.byteLength,
      payload,
      ...(destinationPath === undefined ? {} : { destinationPath }),
    }) !== actionId
  )
    fail("INVALID_PLAN", "Repair plan integrity check failed.");
  if (operation === "salvage" && beforeChecksum !== afterChecksum)
    fail("INVALID_PLAN", "Salvage plans must preserve the source bytes.");
  safePath(sourcePath);
  if (operation === "draft") {
    safePath(backupPath);
    if (backupPath !== sourcePath) fail("INVALID_PLAN", "Repair plan backup path is invalid.");
  } else {
    safeBackupPath(backupPath);
    if (backupPath !== `.object-mcp-recovery/backups/${actionId}.bak`)
      fail("INVALID_PLAN", "Repair plan backup path is invalid.");
  }
  assertSourcePath(sourcePath);
  if (operation === "salvage") {
    if (destinationPath === undefined) fail("INVALID_PLAN", "Repair plan destination is invalid.");
    safePath(destinationPath);
    assertSourcePath(destinationPath);
  }
  const base = {
    version: 1 as const,
    actionId,
    sourcePath,
    beforeChecksum,
    afterChecksum,
    backupPath,
    payload,
    afterSize: bytes.byteLength,
  };
  if (operation === "replace" || operation === "patch") return { ...base, operation };
  if (operation === "draft") {
    if (item.identityAssurance !== "unverified") fail("INVALID_PLAN", "Repair plan is invalid.");
    return { ...base, operation, identityAssurance: "unverified" };
  }
  if (
    operation !== "salvage" ||
    item.identityAssurance !== "unverified" ||
    destinationPath === undefined
  )
    fail("INVALID_PLAN", "Repair plan is invalid.");
  return {
    ...base,
    operation,
    identityAssurance: "unverified",
    destinationPath,
  };
}

export function safePath(relative: string): void {
  try {
    pathComponents(relative);
  } catch {
    fail("INVALID_PLAN", "Repair plan contains an unsafe relative path.");
  }
  if (
    relative === ".object-mcp-lock.sqlite" ||
    relative.startsWith(".object-mcp-lock.sqlite-") ||
    relative.split("/").some((part) => part.startsWith(".vault-stage-")) ||
    relative === ".object-mcp-recovery" ||
    relative.startsWith(".object-mcp-recovery/") ||
    path.posix.normalize(relative) !== relative
  )
    fail("INVALID_PLAN", "Repair plan targets a reserved path.");
}

export function safeBackupPath(relative: string): void {
  try {
    pathComponents(relative);
  } catch {
    fail("INVALID_PLAN", "Repair plan contains an unsafe backup path.");
  }
  if (!/^\.object-mcp-recovery\/backups\/[a-f0-9]{64}(?:\.rollback)?\.bak$/.test(relative))
    fail("INVALID_PLAN", "Repair plan backup path is invalid.");
}

function assertSourcePath(relative: string): void {
  if (relative === ".object-mcp-recovery" || relative.startsWith(".object-mcp-recovery/"))
    fail("INVALID_PLAN", "Repair plan targets a reserved path.");
}

export function result(state: SourceRepairResult["state"], sourcePath: string): SourceRepairResult {
  return { state, sourcePath, sourceCommitted: true, indexState: "not-updated" };
}

export function conflict(): never {
  fail("SOURCE_CONFLICT", "Source no longer matches the approved repair plan.");
}

export function bytesFromPlan(plan: AnySourceRepairPlan, maxBytes: number): Uint8Array {
  return Buffer.from(decodeRepairBase64(plan.payload, maxBytes));
}

export async function ensureBackup(
  files: ConfinedFilesystem,
  relative: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  safeBackupPath(relative);
  let existing: Uint8Array | undefined;
  try {
    existing = await files.readBytes(relative, signal);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (existing) {
    if (checksum(existing) !== checksum(bytes))
      throw new SourceRepairError(
        "BACKUP_CONFLICT",
        "An existing repair backup has different content.",
      );
    return;
  }
  await files.writeBytes(relative, bytes, { expectedChecksum: null }, signal);
}
