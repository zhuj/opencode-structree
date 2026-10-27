import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import type { Provenance, RecoveryFailure, RecoveryIssue, Revision, TextMode } from "./types.ts";

export class RecoveryError extends Error {
  constructor(readonly issue: RecoveryIssue) {
    super(issue.message);
  }
}
export function reject(code: string, message: string): never {
  throw new RecoveryError({ code, message });
}
export function unreachable(value: never): never {
  return reject("INTERNAL", `Unsupported recovery variant: ${typeof value}.`);
}
export function textMode(value: unknown): TextMode {
  switch (value) {
    case "none":
    case "utf8-fatal":
    case "utf8-lossy":
      return value;
    default:
      return reject("DECODING", "Text mode must be none, utf8-fatal or utf8-lossy.");
  }
}
export function issueFrom(error: unknown): RecoveryIssue {
  if (error instanceof RecoveryError) return error.issue;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  switch (code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
    case "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL":
      return { code: "USAGE", message: "Unsupported command options or missing option values." };
    case "ENOENT":
      return { code: "MISSING", message: "The selected filesystem target is missing." };
    case "EACCES":
    case "EPERM":
      return { code: "DENIED", message: "The operating system denied access." };
    case "ELOOP":
    case "ENOTDIR":
      return { code: "UNSAFE_PATH", message: "The path is not a confined regular target." };
    default:
      return { code: "IO", message: "A filesystem operation failed." };
  }
}
export const failure = (error: unknown): RecoveryFailure => ({
  version: 1,
  status: "failed",
  issues: [issueFrom(error)],
});
export function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted)
    reject("CANCELLED", "Recovery was cancelled; already returned bytes remain usable.");
}
export async function closeCaptured(
  resource: { close(): Promise<void> },
  issues: RecoveryIssue[],
): Promise<void> {
  try {
    await resource.close();
  } catch (error) {
    issues.push(issueFrom(error));
  }
}
export function utf8Path(value: string): void {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    Buffer.byteLength(value) > 32768 ||
    Buffer.from(value).toString("utf8") !== value
  )
    reject("PATH", "Expected a nonempty representable filesystem path.");
}
export function components(value: string, allowRoot = false): string[] {
  if (value === "" && allowRoot) return [];
  utf8Path(value);
  const parts = process.platform === "win32" ? value.split(/[\\/]/) : value.split(path.sep);
  if (
    path.isAbsolute(value) ||
    (process.platform === "win32" && /^[a-z]:/i.test(value)) ||
    parts.length > 256 ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    reject("PATH", "Expected a confined native relative path without traversal.");
  return parts;
}
export function integer(value: number, maximum: number, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    reject("BUDGET", "Offset or budget is outside the supported safe integer bounds.");
  return value;
}
export const sameIdentity = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev && left.ino === right.ino;
export function revision(stat: BigIntStats): Revision {
  const fields = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
  return {
    kind: "stat",
    token: createHash("sha256").update(fields.join(":")).digest("hex"),
    device: String(stat.dev),
    inode: String(stat.ino),
    size: String(stat.size),
    modifiedNs: String(stat.mtimeNs),
    changedNs: String(stat.ctimeNs),
  };
}
export function provenance(
  before: Revision,
  after: Revision | null,
  expected?: string,
): Provenance {
  return {
    before,
    after,
    expected:
      expected === undefined ? "not-provided" : expected === before.token ? "matched" : "different",
    consistency:
      after === null ? "unverified" : before.token === after.token ? "stat-stable" : "changed",
    snapshot: false,
  };
}
export function revisionIssues(value: Provenance): RecoveryIssue[] {
  return value.consistency === "changed" || value.expected === "different"
    ? [
        {
          code: "REVISION_CHANGED",
          message: "Stat revision differs; this is not a coherent snapshot.",
        },
      ]
    : [];
}
