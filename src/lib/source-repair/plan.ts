import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { checksum } from "../vault/checksums.ts";
import { applyByteEdits } from "./edits.ts";
import type {
  AnySourceRepairPlan,
  SourceDraftPlan,
  SourceRepairOptions,
  SourceRepairPlan,
  SourceSalvagePlan,
} from "./types.ts";

export const DEFAULT_REPAIR_MAX_BYTES = 5_000_000;
export const backupPathFor = (actionId: string): string =>
  `.object-mcp-recovery/backups/${actionId}.bak`;

export function snapshotOptions(options: SourceRepairOptions): Required<SourceRepairOptions> {
  const copy = { ...options };
  if (copy.driver !== undefined && copy.driver !== "bun" && copy.driver !== "better-sqlite3")
    throw new TypeError("driver must select a supported SQLite driver.");
  if (
    copy.confinement !== undefined &&
    copy.confinement !== "auto" &&
    copy.confinement !== "descriptor" &&
    copy.confinement !== "portable"
  )
    throw new TypeError("confinement must select a supported mode.");
  const maxBytes = copy.maxBytes ?? DEFAULT_REPAIR_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_REPAIR_MAX_BYTES)
    throw new RangeError("maxBytes must be between 1 and 5000000.");
  const lockTimeoutMs = copy.lockTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0)
    throw new RangeError("lockTimeoutMs must be a nonnegative safe integer.");
  if (typeof copy.root !== "string" || copy.root.length === 0)
    throw new TypeError("root must be a nonempty path.");
  return {
    root: copy.root,
    driver: copy.driver ?? "better-sqlite3",
    confinement: copy.confinement ?? "auto",
    maxBytes,
    lockTimeoutMs,
  };
}

export interface RepairActionIdentity {
  readonly operation: string;
  readonly sourcePath: string;
  readonly beforeChecksum: string | null;
  readonly afterChecksum: string;
  readonly afterSize: number;
  readonly payload: string;
  readonly destinationPath?: string;
}

export function repairActionId(identity: RepairActionIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        1,
        identity.operation,
        identity.sourcePath,
        identity.beforeChecksum,
        identity.afterChecksum,
        identity.afterSize,
        identity.payload,
        identity.destinationPath ?? null,
      ]),
    )
    .digest("hex");
}

export function makePlan(
  operation: "draft",
  sourcePath: string,
  before: null,
  after: Uint8Array,
): SourceDraftPlan;
export function makePlan(
  operation: "salvage",
  sourcePath: string,
  before: Uint8Array,
  after: Uint8Array,
  extra: { readonly destinationPath: string },
): SourceSalvagePlan;
export function makePlan(
  operation: "replace" | "patch",
  sourcePath: string,
  before: Uint8Array,
  after: Uint8Array,
): SourceRepairPlan;
export function makePlan(
  operation: AnySourceRepairPlan["operation"],
  sourcePath: string,
  before: Uint8Array | null,
  after: Uint8Array,
  extra: { readonly identityAssurance?: "unverified"; readonly destinationPath?: string } = {},
): AnySourceRepairPlan {
  const beforeChecksum = before === null ? null : checksum(before);
  const afterChecksum = checksum(after);
  const payload = Buffer.from(after).toString("base64");
  const destinationPath =
    operation === "salvage" ? (extra.destinationPath ?? sourcePath) : undefined;
  const id = repairActionId({
    operation,
    sourcePath,
    beforeChecksum,
    afterChecksum,
    afterSize: after.byteLength,
    payload,
    ...(destinationPath === undefined ? {} : { destinationPath }),
  });
  const base = {
    version: 1 as const,
    actionId: id,
    sourcePath,
    beforeChecksum,
    afterChecksum,
    afterSize: after.byteLength,
    payload,
    backupPath: operation === "draft" ? sourcePath : backupPathFor(id),
  };
  if (operation === "draft") return { ...base, operation, identityAssurance: "unverified" };
  if (operation === "salvage")
    return {
      ...base,
      operation,
      identityAssurance: "unverified",
      destinationPath: destinationPath ?? sourcePath,
    };
  return { ...base, operation };
}

export async function planChanged(
  files: { readBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> },
  maxBytes: number,
  operation: "replace" | "patch",
  input: {
    readonly sourcePath: string;
    readonly payload?: Uint8Array;
    readonly edits?: readonly {
      readonly offset: number;
      readonly deleteBytes: number;
      readonly insert: Uint8Array;
    }[];
    readonly expectedChecksum?: string;
  },
  signal?: AbortSignal,
): Promise<SourceRepairPlan> {
  const path = input.sourcePath;
  const expected = input.expectedChecksum;
  const payload = input.payload === undefined ? undefined : Uint8Array.from(input.payload);
  const edits = input.edits?.map((edit) => ({ ...edit, insert: Uint8Array.from(edit.insert) }));
  const original = await files.readBytes(path, signal);
  if (original.byteLength > maxBytes) throw new RangeError("Source exceeds maxBytes.");
  const before = checksum(original);
  if (expected !== undefined && expected !== before)
    throw new Error("Source checksum does not match.");
  let after: Uint8Array;
  if (operation === "replace") {
    if (!payload) throw new TypeError("Replacement payload must be bytes.");
    after = payload;
  } else {
    if (!edits) throw new TypeError("Patch edits must be provided.");
    after = applyByteEdits(original, edits, maxBytes);
  }
  if (after.byteLength > maxBytes) throw new RangeError("Edited source exceeds maxBytes.");
  return makePlan(operation, path, original, after);
}
