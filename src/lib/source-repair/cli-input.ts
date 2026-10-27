import { parseArgs } from "node:util";
import { decodeRepairBase64 } from "./edits.ts";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_PATCH_EDITS = 10_000;
export type RepairCliCommand = "plan" | "apply" | "rollback";
export type RepairCliRequest =
  | {
      readonly operation: "replace";
      readonly sourcePath: string;
      readonly payloadBase64: string;
      readonly expectedChecksum?: string;
    }
  | {
      readonly operation: "draft";
      readonly sourcePath: string;
      readonly payloadBase64: string;
    }
  | {
      readonly operation: "patch";
      readonly sourcePath: string;
      readonly edits: readonly {
        readonly offset: number;
        readonly deleteBytes: number;
        readonly insertBase64: string;
      }[];
      readonly expectedChecksum?: string;
    }
  | {
      readonly operation: "salvage";
      readonly sourcePath: string;
      readonly destinationPath: string;
    };

export interface RepairCliOptions {
  readonly command: RepairCliCommand;
  readonly root: string;
  readonly driver: "bun" | "better-sqlite3" | undefined;
  readonly approved: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !(key in value)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError("Invalid request.");
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseRepairRequest(value: unknown): RepairCliRequest {
  if (!record(value) || !string(value.operation) || !string(value.sourcePath))
    throw new TypeError("Invalid request.");
  const expected = value.expectedChecksum;
  if (expected !== undefined && !string(expected)) throw new TypeError("Invalid request.");
  const checksumOption = expected === undefined ? [] : ["expectedChecksum"];
  switch (value.operation) {
    case "replace":
    case "draft":
      exactKeys(
        value,
        ["operation", "sourcePath", "payloadBase64"],
        value.operation === "replace" ? checksumOption : [],
      );
      if (!string(value.payloadBase64)) throw new TypeError("Invalid request.");
      if (value.operation === "replace")
        return {
          operation: value.operation,
          sourcePath: value.sourcePath,
          payloadBase64: value.payloadBase64,
          ...(expected === undefined ? {} : { expectedChecksum: expected }),
        };
      return {
        operation: value.operation,
        sourcePath: value.sourcePath,
        payloadBase64: value.payloadBase64,
      };
    case "patch": {
      exactKeys(value, ["operation", "sourcePath", "edits"], checksumOption);
      if (!Array.isArray(value.edits) || value.edits.length > MAX_PATCH_EDITS)
        throw new TypeError("Invalid request.");
      const edits = value.edits.map((edit: unknown) => {
        if (!record(edit)) throw new TypeError("Invalid request.");
        exactKeys(edit, ["offset", "deleteBytes", "insertBase64"]);
        if (
          !safeInteger(edit.offset) ||
          !safeInteger(edit.deleteBytes) ||
          !string(edit.insertBase64)
        )
          throw new TypeError("Invalid request.");
        return {
          offset: edit.offset,
          deleteBytes: edit.deleteBytes,
          insertBase64: edit.insertBase64,
        };
      });
      return {
        operation: "patch",
        sourcePath: value.sourcePath,
        edits,
        ...(expected === undefined ? {} : { expectedChecksum: expected }),
      };
    }
    case "salvage":
      exactKeys(value, ["operation", "sourcePath", "destinationPath"]);
      if (!string(value.destinationPath)) throw new TypeError("Invalid request.");
      return {
        operation: "salvage",
        sourcePath: value.sourcePath,
        destinationPath: value.destinationPath,
      };
    default:
      throw new TypeError("Invalid request.");
  }
}

export async function readRepairInput(signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abortInput = () => process.stdin.destroy();
  if (signal.aborted) throw new Error("Repair input was cancelled.");
  signal.addEventListener("abort", abortInput, { once: true });
  try {
    for await (const chunk of process.stdin) {
      if (signal.aborted) throw new Error("Repair input was cancelled.");
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      length += bytes.byteLength;
      if (length > MAX_INPUT_BYTES) throw new RangeError("Request is too large.");
      chunks.push(bytes);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    throw new Error("Repair input was cancelled.");
  } finally {
    signal.removeEventListener("abort", abortInput);
  }
  if (signal.aborted) throw new Error("Repair input was cancelled.");
  if (length === 0) throw new TypeError("A JSON request is required.");
  const input = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return input;
}

export function parseRepairCliOptions(args: readonly string[]): RepairCliOptions {
  const command = args[0];
  if (command !== "plan" && command !== "apply" && command !== "rollback")
    throw new TypeError("Use plan, apply, or rollback with an explicit --root.");
  const { values } = parseArgs({
    args: args.slice(1),
    strict: true,
    allowPositionals: false,
    options: { root: { type: "string" }, driver: { type: "string" }, approve: { type: "boolean" } },
  });
  if (
    !values.root ||
    (values.driver !== undefined && values.driver !== "bun" && values.driver !== "better-sqlite3")
  )
    throw new TypeError("An explicit --root and a supported optional --driver are required.");
  if (
    (command === "plan" && values.approve !== undefined) ||
    (command !== "plan" && values.approve !== true)
  )
    throw new TypeError("Apply and rollback require the exact --approve flag.");
  return { command, root: values.root, driver: values.driver, approved: values.approve === true };
}

export function validateRepairPayloads(input: RepairCliRequest): void {
  if (input.operation === "replace" || input.operation === "draft") {
    decodeRepairBase64(input.payloadBase64);
    return;
  }
  if (input.operation === "patch") {
    let total = 0;
    for (const edit of input.edits) total += decodeRepairBase64(edit.insertBase64).byteLength;
    if (total > 5_000_000) throw new RangeError("Patch data is too large.");
  }
}
