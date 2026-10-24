import type { JsonObject, JsonValue } from "../model/index.ts";
import type { HeaderChange } from "./types.ts";

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function canonical(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function leaves(header: JsonObject): Map<string, JsonValue> {
  const result = new Map<string, JsonValue>();
  const visit = (value: JsonValue, path: readonly string[]): void => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (entries.length > 0) {
        for (const [key, child] of entries) visit(child, [...path, key]);
        return;
      }
    }
    const encoded = path.map((key) => key.replace(/\\/g, "\\\\").replace(/\./g, "\\.")).join(".");
    result.set(encoded, canonical(value));
  };
  for (const [key, value] of Object.entries(header)) visit(value, [key]);
  return result;
}

export function diffHeaders(previous: JsonObject, current: JsonObject): HeaderChange[] {
  const before = leaves(previous);
  const after = leaves(current);
  const changes: HeaderChange[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
    const from = before.get(path);
    const to = after.get(path);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ path, from, to });
  }
  return changes;
}
