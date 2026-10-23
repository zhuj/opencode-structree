import type { JsonValue, MaterializedObject } from "../../src/lib/model/index.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function json(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(json);
  return (
    record(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Object.values(value).every(json)
  );
}
function materialized(value: unknown): value is MaterializedObject {
  if (
    !record(value) ||
    typeof value.type !== "string" ||
    typeof value.id !== "string" ||
    !record(value.header) ||
    !json(value.header) ||
    typeof value.body !== "string"
  )
    return false;
  if (
    !record(value.source) ||
    value.source.root !== "vault" ||
    typeof value.source.path !== "string" ||
    typeof value.source.checksum !== "string"
  )
    return false;
  if (
    !Array.isArray(value.references) ||
    !value.references.every(
      (ref: unknown) =>
        record(ref) &&
        typeof ref.field === "string" &&
        typeof ref.kind === "string" &&
        ["depends", "uses", "justifies", "contains", "owns", "relates"].includes(ref.kind) &&
        record(ref.target) &&
        typeof ref.target.type === "string" &&
        typeof ref.target.id === "string",
    )
  )
    return false;
  return (
    Array.isArray(value.fileBindings) &&
    value.fileBindings.every(
      (binding: unknown) =>
        record(binding) &&
        binding.root === "project" &&
        typeof binding.path === "string" &&
        (binding.role === "implementation" ||
          binding.role === "test" ||
          binding.role === "documentation") &&
        (binding.symbol === undefined || typeof binding.symbol === "string"),
    )
  );
}
export async function loadGeneratedObjects(file: string): Promise<readonly MaterializedObject[]> {
  const loaded: unknown = await import(file);
  if (!record(loaded) || !Array.isArray(loaded.objects) || !loaded.objects.every(materialized))
    throw new Error("Generated module did not expose materialized objects.");
  return loaded.objects;
}
