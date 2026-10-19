import type { JsonSchema } from "effect";

export type JsonPrimitive = string | number | boolean | null;

export interface RepairProperty {
  readonly shape: RepairShape;
  readonly optional: boolean;
}

export type RepairShape =
  | { readonly kind: "opaque" }
  | { readonly kind: "never" }
  | {
      readonly kind: "scalar";
      readonly type: "string" | "number" | "integer" | "boolean" | "null";
    }
  | { readonly kind: "literal"; readonly values: readonly JsonPrimitive[] }
  | { readonly kind: "array"; readonly items: RepairShape }
  | {
      readonly kind: "object";
      readonly properties: Readonly<Record<string, RepairProperty>>;
      readonly additionalProperties: boolean;
    }
  | { readonly kind: "union"; readonly variants: readonly RepairShape[] }
  | { readonly kind: "ref"; readonly target: RepairShape };

const opaque = Object.freeze({ kind: "opaque" } as const);
const never = Object.freeze({ kind: "never" } as const);
const maxSchemaDepth = 128;
const maxSchemaNodes = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Repair hints describe encoded JSON; the original Effect codec remains the validator. */
export function jsonSchemaToRepairShape(
  document: JsonSchema.Document<"draft-2020-12">,
): RepairShape {
  const seen = new WeakMap<object, RepairShape>();
  let nodes = 0;

  function resolvePointer(reference: string): unknown {
    if (!reference.startsWith("#")) return undefined;
    let pointer: string;
    try {
      pointer = decodeURIComponent(reference.slice(1));
    } catch {
      return undefined;
    }
    if (pointer === "") return document.schema;
    if (!pointer.startsWith("/")) return undefined;
    const tokens = pointer
      .slice(1)
      .split("/")
      .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
    let value: unknown = document.schema;
    if (tokens[0] === "$defs") {
      value = document.definitions;
      tokens.shift();
    }
    for (const token of tokens) {
      if (!isRecord(value) || !Object.hasOwn(value, token)) return undefined;
      value = value[token];
    }
    return value;
  }

  function visit(value: unknown, depth: number): RepairShape {
    if (value === false) return never;
    if (!isRecord(value)) return opaque;
    const cached = seen.get(value);
    if (cached !== undefined) return cached;
    if (depth > maxSchemaDepth || ++nodes > maxSchemaNodes) return opaque;

    const reference: { kind: "ref"; target: RepairShape } = { kind: "ref", target: opaque };
    seen.set(value, reference);
    reference.target = inspect(value, depth);
    return reference.target;
  }

  function union(variants: readonly unknown[], depth: number): RepairShape {
    if (variants.length === 0) return never;
    if (variants.length === 1) return visit(variants[0], depth + 1);
    return { kind: "union", variants: variants.map((variant) => visit(variant, depth + 1)) };
  }

  function inspect(schema: Record<string, unknown>, depth: number): RepairShape {
    if (schema.not === true || (isRecord(schema.not) && Object.keys(schema.not).length === 0)) {
      return never;
    }
    // Intersections and conditionals need the codec's complete semantics before choosing a repair.
    if (schema.allOf !== undefined || schema.if !== undefined || schema.not !== undefined) {
      return opaque;
    }
    if (typeof schema.$ref === "string") {
      return visit(resolvePointer(schema.$ref), depth + 1);
    }
    if (Array.isArray(schema.anyOf)) return union(schema.anyOf, depth);
    if (Array.isArray(schema.oneOf)) return union(schema.oneOf, depth);
    if (Object.hasOwn(schema, "const")) {
      return isPrimitive(schema.const) ? { kind: "literal", values: [schema.const] } : opaque;
    }
    if (Array.isArray(schema.enum)) {
      if (schema.enum.length === 0) return never;
      return schema.enum.every(isPrimitive) ? { kind: "literal", values: schema.enum } : opaque;
    }
    if (Array.isArray(schema.type)) {
      return union(
        schema.type.map((type: unknown) => ({ ...schema, type })),
        depth,
      );
    }
    switch (schema.type) {
      case "string":
      case "number":
      case "integer":
      case "boolean":
      case "null":
        return { kind: "scalar", type: schema.type };
      case "array":
        if (schema.prefixItems !== undefined || Array.isArray(schema.items)) return opaque;
        return { kind: "array", items: visit(schema.items, depth + 1) };
      case "object":
        return objectShape(schema, depth);
      default:
        return opaque;
    }
  }

  function objectShape(schema: Record<string, unknown>, depth: number): RepairShape {
    const declared = isRecord(schema.properties) ? schema.properties : {};
    const additionalProperties =
      schema.additionalProperties !== false || schema.patternProperties !== undefined;
    // Map keys and arbitrary JSON are application data, even if their values have a schema.
    if (Object.keys(declared).length === 0 && additionalProperties) return opaque;
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((key): key is string => typeof key === "string")
        : [],
    );
    const properties: Record<string, RepairProperty> = Object.create(null);
    for (const [key, value] of Object.entries(declared)) {
      properties[key] = { shape: visit(value, depth + 1), optional: !required.has(key) };
    }
    return { kind: "object", properties, additionalProperties };
  }

  return visit(document.schema, 0);
}

/** A ref-only cycle has no usable repair information and must remain opaque. */
export function resolveRepairShape(shape: RepairShape): Exclude<RepairShape, { kind: "ref" }> {
  const seen = new Set<RepairShape>();
  while (shape.kind === "ref") {
    if (seen.has(shape)) return opaque;
    seen.add(shape);
    shape = shape.target;
  }
  return shape;
}
