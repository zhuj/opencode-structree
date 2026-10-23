/** Recoverable source data is JSON, not a successfully decoded domain header. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonRecord;
export interface JsonRecord {
  readonly [key: string]: JsonValue;
}

export interface DocumentIssue {
  readonly code: string;
  readonly message: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reject a whole field rather than present a truncated cyclic/non-JSON value as source data. */
function jsonValue(value: unknown, ancestors: Set<object>): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object" || ancestors.has(value) || ancestors.size >= 100) return undefined;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return undefined;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: JsonValue[] = [];
      for (const item of value) {
        const parsed = jsonValue(item, ancestors);
        if (parsed === undefined) return undefined;
        items.push(parsed);
      }
      return items;
    }
    const entries: [string, JsonValue][] = [];
    for (const [key, child] of Object.entries(value)) {
      const parsed = jsonValue(child, ancestors);
      if (parsed === undefined) return undefined;
      entries.push([key, parsed]);
    }
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

export function recoverJson(
  value: Record<string, unknown>,
  omitted: ReadonlySet<string>,
): { json: JsonRecord; dropped: boolean } {
  const entries: [string, JsonValue][] = [];
  let dropped = omitted.size > 0;
  for (const [key, child] of Object.entries(value)) {
    if (omitted.has(key)) continue;
    const parsed = jsonValue(child, new Set());
    if (parsed === undefined) dropped = true;
    else entries.push([key, parsed]);
  }
  return { json: Object.fromEntries(entries), dropped };
}
