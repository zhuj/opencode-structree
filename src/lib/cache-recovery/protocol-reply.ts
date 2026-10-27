import type { RecoveryWorkerFailure, RecoveryWorkerReply } from "./protocol-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
function operation(value: unknown): value is RecoveryWorkerReply["operation"] {
  return (
    value === "inspect" ||
    value === "verify" ||
    value === "collect" ||
    value === "build" ||
    value === "checkpoint"
  );
}
function failure(value: unknown): value is RecoveryWorkerFailure {
  return (
    value === "BAD_REQUEST" ||
    value === "SOURCE_INCOMPLETE" ||
    value === "SOURCE_CHANGED" ||
    value === "CACHE_BLOCKED" ||
    value === "CANDIDATE_FAILED" ||
    value === "CANDIDATE_SIZE" ||
    value === "CANDIDATE_METADATA" ||
    value === "CANDIDATE_INTEGRITY" ||
    value === "CANDIDATE_CREATE_FAILED" ||
    value === "CANDIDATE_INDEX_FAILED" ||
    value === "CANDIDATE_CHECKPOINT_FAILED" ||
    value === "CANDIDATE_INSPECT_FAILED" ||
    value === "CANCELLED"
  );
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}
function checksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function parseWorkerReply(value: unknown): RecoveryWorkerReply | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !operation(value.operation) ||
    !string(value.status)
  )
    return undefined;
  if (
    value.status === "blocked" &&
    onlyKeys(value, ["version", "operation", "status", "code"]) &&
    failure(value.code)
  )
    return { version: 1, operation: value.operation, status: "blocked", code: value.code };
  if (value.status !== "ok") return undefined;
  if (
    (value.operation === "inspect" || value.operation === "verify") &&
    onlyKeys(value, [
      "version",
      "operation",
      "status",
      "checksum",
      "byteLength",
      "device",
      "inode",
      "objectCount",
      "embeddingCount",
    ]) &&
    checksum(value.checksum) &&
    integer(value.byteLength) &&
    string(value.device) &&
    string(value.inode) &&
    integer(value.objectCount) &&
    integer(value.embeddingCount)
  )
    return {
      version: 1,
      operation: value.operation,
      status: "ok",
      checksum: value.checksum,
      byteLength: value.byteLength,
      device: value.device,
      inode: value.inode,
      objectCount: value.objectCount,
      embeddingCount: value.embeddingCount,
    };
  if (
    value.operation === "collect" &&
    onlyKeys(value, ["version", "operation", "status", "fingerprint", "files", "bytes"]) &&
    checksum(value.fingerprint) &&
    integer(value.files) &&
    integer(value.bytes)
  )
    return {
      version: 1,
      operation: "collect",
      status: "ok",
      fingerprint: value.fingerprint,
      files: value.files,
      bytes: value.bytes,
    };
  if (
    value.operation === "build" &&
    onlyKeys(value, [
      "version",
      "operation",
      "status",
      "fingerprint",
      "files",
      "bytes",
      "objectCount",
      "embeddingCount",
    ]) &&
    checksum(value.fingerprint) &&
    integer(value.files) &&
    integer(value.bytes) &&
    integer(value.objectCount) &&
    integer(value.embeddingCount)
  )
    return {
      version: 1,
      operation: "build",
      status: "ok",
      fingerprint: value.fingerprint,
      files: value.files,
      bytes: value.bytes,
      objectCount: value.objectCount,
      embeddingCount: value.embeddingCount,
    };
  if (
    value.operation === "checkpoint" &&
    onlyKeys(value, [
      "version",
      "operation",
      "status",
      "checksum",
      "byteLength",
      "device",
      "inode",
      "objectCount",
      "embeddingCount",
    ]) &&
    checksum(value.checksum) &&
    integer(value.byteLength) &&
    string(value.device) &&
    string(value.inode) &&
    integer(value.objectCount) &&
    integer(value.embeddingCount)
  )
    return {
      version: 1,
      operation: "checkpoint",
      status: "ok",
      checksum: value.checksum,
      byteLength: value.byteLength,
      device: value.device,
      inode: value.inode,
      objectCount: value.objectCount,
      embeddingCount: value.embeddingCount,
    };
  return undefined;
}
