import { Database, constants as sqliteConstants } from "bun:sqlite";
import { pathToFileURL } from "node:url";
import {
  closePreparedCacheFile,
  prepareClosedCacheFile,
  verifyPreparedCacheFile,
} from "./inspect-file.ts";

const APPLICATION_ID = 0x4f4d4350;
const SCHEMA_VERSION = 3;
const EXPECTED_OBJECTS = [
  "index:embeddings_model",
  "index:object_meta_type",
  "table:cache_state",
  "table:embeddings",
  "table:object_fts",
  "table:object_fts_config",
  "table:object_fts_content",
  "table:object_fts_data",
  "table:object_fts_docsize",
  "table:object_fts_idx",
  "table:object_meta",
  "table:object_meta_mutation_revisions",
  "table:sync_issues",
  "trigger:object_meta_delete",
  "trigger:object_meta_insert",
  "trigger:object_meta_mutation_revisions_DELETE",
  "trigger:object_meta_mutation_revisions_INSERT",
  "trigger:object_meta_mutation_revisions_MOVE",
  "trigger:object_meta_mutation_revisions_UPDATE",
  "trigger:object_meta_update",
].sort();

export type CacheInspectionCode =
  | "ABORTED"
  | "INVALID_OPTIONS"
  | "UNSAFE_PATH"
  | "TARGET_MISSING"
  | "UNSAFE_TARGET"
  | "SIDECAR_PRESENT"
  | "SIZE_LIMIT"
  | "IO_BLOCKED"
  | "UNKNOWN_FORMAT"
  | "OWNERSHIP_MISMATCH"
  | "SCHEMA_MISMATCH"
  | "INTEGRITY_FAILED"
  | "INVALID_HEADER";

export interface InspectClosedCacheOptions {
  readonly authorizedDirectory: string;
  readonly relativeFilename: string;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export type ClosedCacheInspection =
  | {
      readonly status: "accepted";
      readonly code: "CURRENT_CACHE";
      readonly checksum: string;
      readonly byteLength: number;
      readonly device: string;
      readonly inode: string;
      readonly applicationId: number;
      readonly schemaVersion: number;
      readonly objectCount: number;
      readonly embeddingCount: number;
    }
  | { readonly status: "blocked"; readonly code: CacheInspectionCode };

const blocked = (code: CacheInspectionCode): ClosedCacheInspection => ({ status: "blocked", code });
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;
const safeCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

type NativeInspection =
  | { readonly state: "ok"; readonly objectCount: number; readonly embeddingCount: number }
  | { readonly state: "owner" | "schema" | "integrity" | "unknown" };

async function inspectNative(file: string): Promise<NativeInspection> {
  let database: InstanceType<typeof Database> | undefined;
  try {
    const uri = pathToFileURL(file);
    uri.searchParams.set("mode", "ro");
    uri.searchParams.set("immutable", "1");
    database = new Database(
      uri.href,
      sqliteConstants.SQLITE_OPEN_READONLY | sqliteConstants.SQLITE_OPEN_URI,
    );
    const app = record(database.query("PRAGMA application_id").get())?.application_id;
    const version = record(database.query("PRAGMA user_version").get())?.user_version;
    if (app !== APPLICATION_ID || version !== SCHEMA_VERSION) return { state: "owner" };
    const objects = database
      .query(
        "SELECT type || ':' || name AS object FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name LIMIT 22",
      )
      .all()
      .map((row) => record(row)?.object);
    if (
      objects.length !== EXPECTED_OBJECTS.length ||
      objects.some((object, i) => object !== EXPECTED_OBJECTS[i])
    )
      return { state: "schema" };
    const integrity = record(database.query("PRAGMA integrity_check(1)").get())?.integrity_check;
    if (integrity !== "ok") return { state: "integrity" };
    const metadataColumns = database
      .query("SELECT name FROM pragma_table_info('object_meta') LIMIT 15")
      .all()
      .map((row) => record(row)?.name);
    if (
      metadataColumns.join(",") !==
      "object_key,object_type,id,name,title,path,checksum,json,raw,body,embedding_fingerprint,embedding_checksum,embedding_dimensions,embedding_chunks"
    )
      return { state: "schema" };
    const requiredColumns = [
      [
        "embeddings",
        "object_key,chunk_index,checksum,fingerprint,dimensions,start_offset,end_offset,chunk_text,vector",
      ],
      ["cache_state", "singleton,generation"],
      ["sync_issues", "path,code,message"],
    ] as const;
    for (const [table, expected] of requiredColumns) {
      const columns = database
        .query(`SELECT name FROM pragma_table_info('${table}') LIMIT 15`)
        .all()
        .map((row) => record(row)?.name);
      if (columns.join(",") !== expected) return { state: "schema" };
    }
    database
      .query("SELECT object_key FROM object_fts WHERE object_fts MATCH ? LIMIT 1")
      .get("cacheprobe");
    const objectsCount = safeCount(
      record(database.query("SELECT COUNT(*) AS count FROM object_meta").get())?.count,
    );
    const embeddingsCount = safeCount(
      record(database.query("SELECT COUNT(*) AS count FROM embeddings").get())?.count,
    );
    return objectsCount === undefined || embeddingsCount === undefined
      ? { state: "schema" }
      : { state: "ok", objectCount: objectsCount, embeddingCount: embeddingsCount };
  } catch {
    return { state: "unknown" };
  } finally {
    database?.close();
  }
}

type NativeInspector = (file: string) => Promise<NativeInspection>;
let nativeInspector: NativeInspector = inspectNative;

export async function withNativeInspectionHookForTest<A>(
  inspect: NativeInspector,
  work: () => Promise<A>,
): Promise<A> {
  const previous = nativeInspector;
  nativeInspector = inspect;
  try {
    return await work();
  } finally {
    nativeInspector = previous;
  }
}

/** Read-only admission check for one existing, closed, self-contained cache file. */
export async function inspectClosedCache(
  options: InspectClosedCacheOptions,
): Promise<ClosedCacheInspection> {
  const snapshot: InspectClosedCacheOptions = {
    authorizedDirectory: options.authorizedDirectory,
    relativeFilename: options.relativeFilename,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const prepared = await prepareClosedCacheFile(snapshot);
  if (prepared.status === "blocked") return blocked(prepared.code);
  let outcome: ClosedCacheInspection;
  try {
    const native = await nativeInspector(prepared.file);
    const verificationFailure = snapshot.signal?.aborted
      ? "ABORTED"
      : await verifyPreparedCacheFile(prepared);
    if (verificationFailure !== undefined) outcome = blocked(verificationFailure);
    else if (native.state === "owner") outcome = blocked("OWNERSHIP_MISMATCH");
    else if (native.state === "schema") outcome = blocked("SCHEMA_MISMATCH");
    else if (native.state === "integrity") outcome = blocked("INTEGRITY_FAILED");
    else if (native.state !== "ok") outcome = blocked("UNKNOWN_FORMAT");
    else {
      outcome = {
        status: "accepted",
        code: "CURRENT_CACHE",
        checksum: prepared.checksum,
        byteLength: prepared.byteLength,
        device: prepared.identity.dev.toString(),
        inode: prepared.identity.ino.toString(),
        applicationId: APPLICATION_ID,
        schemaVersion: SCHEMA_VERSION,
        objectCount: native.objectCount,
        embeddingCount: native.embeddingCount,
      };
    }
  } catch {
    outcome = blocked("IO_BLOCKED");
  }
  try {
    await closePreparedCacheFile(prepared);
  } catch {
    if (outcome.status === "accepted") outcome = blocked("IO_BLOCKED");
  }
  return outcome;
}
