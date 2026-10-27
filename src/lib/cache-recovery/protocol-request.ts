import type { FrameworkConfig } from "../types.ts";
import type { RecoveryWorkerRequest } from "./protocol-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}
function keysWithin(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function sqliteOptions(
  value: Record<string, unknown>,
): Omit<FrameworkConfig["sqlite"], "path"> | undefined {
  if (
    !keysWithin(value, ["driver", "busyTimeoutMs", "extensionPath", "customSQLite"]) ||
    (value.driver !== "bun" && value.driver !== "better-sqlite3") ||
    !integer(value.busyTimeoutMs) ||
    (value.extensionPath !== undefined && !string(value.extensionPath)) ||
    (value.customSQLite !== undefined && !string(value.customSQLite))
  )
    return undefined;
  return {
    driver: value.driver,
    busyTimeoutMs: value.busyTimeoutMs,
    ...(value.extensionPath === undefined ? {} : { extensionPath: value.extensionPath }),
    ...(value.customSQLite === undefined ? {} : { customSQLite: value.customSQLite }),
  };
}
function searchOptions(value: Record<string, unknown>): FrameworkConfig["search"] | undefined {
  const keys = [
    "defaultTopN",
    "maxTopN",
    "candidateMultiplier",
    "rrfK",
    "fulltextWeight",
    "semanticWeight",
    "maxMatchCharacters",
  ] as const;
  if (
    !onlyKeys(value, keys) ||
    !integer(value.defaultTopN) ||
    value.defaultTopN < 1 ||
    !integer(value.maxTopN) ||
    value.maxTopN < 1 ||
    !integer(value.rrfK) ||
    value.rrfK < 1 ||
    !integer(value.maxMatchCharacters) ||
    value.maxMatchCharacters < 1 ||
    !positive(value.candidateMultiplier) ||
    !nonnegative(value.fulltextWeight) ||
    !nonnegative(value.semanticWeight)
  )
    return undefined;
  return {
    defaultTopN: value.defaultTopN,
    maxTopN: value.maxTopN,
    candidateMultiplier: value.candidateMultiplier,
    rrfK: value.rrfK,
    fulltextWeight: value.fulltextWeight,
    semanticWeight: value.semanticWeight,
    maxMatchCharacters: value.maxMatchCharacters,
  };
}

function operation(value: unknown): value is RecoveryWorkerRequest["operation"] {
  return (
    value === "inspect" ||
    value === "verify" ||
    value === "collect" ||
    value === "build" ||
    value === "checkpoint"
  );
}

export function parseWorkerRequest(value: unknown): RecoveryWorkerRequest | undefined {
  if (!isRecord(value) || value.version !== 1 || !operation(value.operation)) return undefined;
  if (
    value.operation === "verify" &&
    onlyKeys(value, [
      "version",
      "operation",
      "root",
      "relativeFilename",
      "maxBytes",
      "sourceRoot",
      "expectedFingerprint",
      "expectedChecksum",
    ]) &&
    string(value.root) &&
    string(value.relativeFilename) &&
    string(value.sourceRoot) &&
    string(value.expectedFingerprint) &&
    /^[a-f0-9]{64}$/.test(value.expectedFingerprint) &&
    string(value.expectedChecksum) &&
    /^[a-f0-9]{64}$/.test(value.expectedChecksum) &&
    integer(value.maxBytes) &&
    value.maxBytes > 0 &&
    value.maxBytes <= 64 * 1024 * 1024
  )
    return {
      version: 1,
      operation: "verify",
      root: value.root,
      relativeFilename: value.relativeFilename,
      sourceRoot: value.sourceRoot,
      expectedFingerprint: value.expectedFingerprint,
      expectedChecksum: value.expectedChecksum,
      maxBytes: value.maxBytes,
    };
  if (
    value.operation === "inspect" &&
    onlyKeys(value, ["version", "operation", "root", "relativeFilename", "maxBytes"]) &&
    string(value.root) &&
    string(value.relativeFilename) &&
    integer(value.maxBytes) &&
    value.maxBytes > 0 &&
    value.maxBytes <= 64 * 1024 * 1024
  )
    return {
      version: 1,
      operation: "inspect",
      root: value.root,
      relativeFilename: value.relativeFilename,
      maxBytes: value.maxBytes,
    };
  if (
    value.operation === "collect" &&
    onlyKeys(value, ["version", "operation", "sourceRoot"]) &&
    string(value.sourceRoot)
  )
    return { version: 1, operation: "collect", sourceRoot: value.sourceRoot };
  if (
    value.operation === "checkpoint" &&
    onlyKeys(value, [
      "version",
      "operation",
      "workDirectory",
      "candidateFilename",
      "candidateMaxBytes",
    ]) &&
    string(value.workDirectory) &&
    string(value.candidateFilename) &&
    /^[a-f0-9]{64}\.candidate\.sqlite$/.test(value.candidateFilename) &&
    integer(value.candidateMaxBytes) &&
    value.candidateMaxBytes > 0 &&
    value.candidateMaxBytes <= 64 * 1024 * 1024
  )
    return {
      version: 1,
      operation: "checkpoint",
      workDirectory: value.workDirectory,
      candidateFilename: value.candidateFilename,
      candidateMaxBytes: value.candidateMaxBytes,
    };
  if (
    value.operation === "build" &&
    onlyKeys(value, [
      "version",
      "operation",
      "sourceRoot",
      "workDirectory",
      "candidateFilename",
      "expectedFingerprint",
      "candidateMaxBytes",
      "sqlite",
      "search",
    ]) &&
    string(value.sourceRoot) &&
    string(value.workDirectory) &&
    string(value.candidateFilename) &&
    /^[a-f0-9]{64}\.candidate\.sqlite$/.test(value.candidateFilename) &&
    string(value.expectedFingerprint) &&
    /^[a-f0-9]{64}$/.test(value.expectedFingerprint) &&
    integer(value.candidateMaxBytes) &&
    value.candidateMaxBytes > 0 &&
    value.candidateMaxBytes <= 64 * 1024 * 1024 &&
    isRecord(value.sqlite) &&
    isRecord(value.search)
  ) {
    const sqlite = sqliteOptions(value.sqlite);
    const search = searchOptions(value.search);
    if (!sqlite || !search) return undefined;
    return {
      version: 1,
      operation: "build",
      sourceRoot: value.sourceRoot,
      workDirectory: value.workDirectory,
      candidateFilename: value.candidateFilename,
      expectedFingerprint: value.expectedFingerprint,
      candidateMaxBytes: value.candidateMaxBytes,
      sqlite,
      search,
    };
  }
  return undefined;
}
