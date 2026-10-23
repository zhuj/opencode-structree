import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "../model/index.ts";

export const digest = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (
    isRecord(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, jsonValue(value[key])]),
    );
  throw new TypeError("Expected a finite JSON wire value.");
}
export function jsonObject(value: unknown): JsonObject {
  const json = jsonValue(value);
  if (json === null || typeof json !== "object" || Array.isArray(json))
    throw new TypeError("Expected a JSON mapping.");
  // Array.isArray does not narrow readonly array unions in TypeScript.
  if (!isRecord(json)) throw new TypeError("Expected a JSON mapping.");
  return Object.fromEntries(Object.entries(json).map(([key, value]) => [key, jsonValue(value)]));
}
export const stableJson = (value: unknown): string => JSON.stringify(jsonValue(value), null, 2);
/** JSON strings cannot become TypeScript expressions, even with Unicode line separators. */
export function literal(value: unknown): string {
  const emit = (value: JsonValue): string => {
    if (value === null || typeof value !== "object")
      return JSON.stringify(value)
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    if (Array.isArray(value)) return `[${value.map(emit).join(", ")}]`;
    // Computed keys preserve __proto__ as ordinary own data, not a prototype setter.
    return `{${Object.entries(value)
      .map(([key, child]) => `[${emit(key)}]: ${emit(child)}`)
      .join(", ")}}`;
  };
  return emit(jsonValue(value));
}
export const atPath = (value: unknown, field: string): unknown => {
  let current = value;
  for (const part of field.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
};
