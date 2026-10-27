import { FrameworkError } from "../errors.ts";
import type { ScanResult } from "../filesystem.ts";
import type { ObjectListResult } from "../types.ts";
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from "../types.ts";
import { publicObject } from "./result.ts";

const SEMANTIC_ISSUES = new Set(["FRONTMATTER", "YAML", "VALIDATION"]);
const NON_OMISSION_ISSUES = new Set([...SEMANTIC_ISSUES, "DUPLICATE_ID"]);

export function hasSourceOmission(scan: ScanResult): boolean {
  return scan.issues.some((issue) => !NON_OMISSION_ISSUES.has(issue.code));
}

export function listSource(
  scan: ScanResult,
  options: { readonly limit?: number; readonly offset?: number } = {},
): ObjectListResult {
  const limit = options.limit ?? LIST_LIMIT_DEFAULT;
  const offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > LIST_LIMIT_MAX ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new FrameworkError(
      "VALIDATION",
      `List limit must be 1..${LIST_LIMIT_MAX} and offset must be nonnegative integers.`,
    );

  const documents = [...scan.documents].sort((left, right) =>
    left.object.id.localeCompare(right.object.id),
  );
  const observedCount = documents.length;
  const objects = documents.slice(offset, offset + limit).map(publicObject);
  const continuation = offset + limit < observedCount ? { offset: offset + limit } : null;
  const incomplete = !scan.complete || scan.conflictedKeys.length > 0 || hasSourceOmission(scan);
  if (incomplete) {
    return {
      objects,
      complete: false,
      total: null,
      observedCount,
      issues: scan.issues,
      continuation,
    };
  }
  return {
    objects,
    total: observedCount,
    complete: true,
    observedCount,
    issues: scan.issues,
    continuation,
  };
}
