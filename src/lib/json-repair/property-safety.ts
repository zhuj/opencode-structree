import { types } from "node:util";
import { pointer, type RepairError, type RepairOptions, resolveRepairOptions } from "./types.ts";

export function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

/** Wire data has no getters, class instances, cycles, or inherited application properties. */
export function inspectInput(input: unknown, options: RepairOptions = {}): RepairError[] {
  const limits = resolveRepairOptions(options);
  const active = new WeakSet<object>();
  const pending: { value: unknown; path: (string | number)[]; exit?: boolean }[] = [
    { value: input, path: [] },
  ];
  let bytes = 0;
  let nodes = 0;
  const fail = (
    path: readonly (string | number)[],
    code: string,
    message: string,
  ): RepairError[] => [{ path: pointer(path), code, message }];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) break;
    const { value, path } = frame;
    if (frame.exit && typeof value === "object" && value !== null) {
      active.delete(value);
      continue;
    }
    if (++nodes > limits.maxNodes || path.length > limits.maxDepth) {
      return fail(path, "RESOURCE_LIMIT", "Input exceeds the configured node or depth limit.");
    }
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > limits.maxInputBytes)
        return fail(path, "RESOURCE_LIMIT", "Input exceeds the configured byte limit.");
      bytes += Buffer.byteLength(JSON.stringify(value), "utf8");
    } else if (value === null) bytes += 4;
    else if (typeof value === "boolean") bytes += value ? 4 : 5;
    else if (typeof value === "number" && Number.isFinite(value)) bytes += String(value).length;
    else if (typeof value === "object" && value !== null) {
      if (types.isProxy(value))
        return fail(path, "UNSAFE_INPUT", "Proxy objects are not JSON data.");
      if (path.length >= limits.maxDepth)
        return fail(path, "RESOURCE_LIMIT", "Input exceeds the configured container depth limit.");
      if (active.has(value)) return fail(path, "UNSAFE_INPUT", "Cyclic input is not JSON data.");
      const prototype = Object.getPrototypeOf(value);
      if (
        Array.isArray(value)
          ? prototype !== Array.prototype
          : prototype !== Object.prototype && prototype !== null
      ) {
        return fail(path, "UNSAFE_INPUT", "Only plain JSON objects and arrays are accepted.");
      }
      const keys = Reflect.ownKeys(value);
      if (keys.length + nodes > limits.maxNodes + 1)
        return fail(path, "RESOURCE_LIMIT", "Input exceeds the configured node limit.");
      if (Array.isArray(value) && value.length + 1 !== keys.length)
        return fail(
          path,
          "UNSAFE_INPUT",
          "Sparse arrays and named array properties are not JSON data.",
        );
      const members = keys.length - (Array.isArray(value) ? 1 : 0);
      bytes += 2 + Math.max(0, members - 1);
      active.add(value);
      pending.push({ value, path, exit: true });
      for (const key of keys) {
        if (typeof key !== "string")
          return fail(path, "UNSAFE_INPUT", "Symbol properties are not JSON data.");
        if (Array.isArray(value) && key === "length") continue;
        if (isUnsafeKey(key))
          return fail([...path, key], "UNSAFE_INPUT", "Unsafe property names are not accepted.");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          !descriptor.enumerable
        ) {
          return fail(
            [...path, key],
            "UNSAFE_INPUT",
            "Accessors and hidden properties are not JSON data.",
          );
        }
        if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
          return fail([...path, key], "UNSAFE_INPUT", "Named array properties are not JSON data.");
        }
        if (!Array.isArray(value)) bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
        pending.push({ value: descriptor.value, path: [...path, key] });
      }
    } else return fail(path, "UNSAFE_INPUT", "Values must be finite, plain JSON data.");
    if (bytes > limits.maxInputBytes)
      return fail(path, "RESOURCE_LIMIT", "Input exceeds the configured byte limit.");
  }
  return [];
}
